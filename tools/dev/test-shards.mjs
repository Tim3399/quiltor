import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Splits the browser suites across CI slots by measured duration instead of by test count.
 *
 *   node tools/dev/test-shards.mjs select --os linux --slots 4 --slot 1 --out-dir <dir>
 *   node tools/dev/test-shards.mjs plan   --os linux --slots 4 [--list-product <json>] ...
 *   node tools/dev/test-shards.mjs update --suite product --os linux <report.json>...
 *
 * `--shard` cuts by count, and many product tests skip themselves for a project, so one Linux
 * slot got 172 tests that ran and another 82 -- 10.3 against 4.2 minutes. Here every test
 * carries a duration from tests/playwright/durations.json, and the slots are filled longest
 * first, each test onto the slot with the least work.
 *
 * Both suites share a slot, so they are balanced together: the product suite first, then the
 * design suite onto what the product suite left. A slot's other work -- the unit tests in
 * slot 1 -- counts as an offset. Per-test durations are converted to wall time with the
 * suite's measured wall factor on that system (workers, and how the suite scales with them).
 *
 * `select` lists both suites with Playwright, assigns every slot, checks that every test lands
 * in exactly one, writes this slot's lines as `--test-list` files (`product.txt`,
 * `design.txt`), and then asks Playwright which tests each file selects: anything but exactly
 * the assigned tests is an error. A test the table does not know gets the table's median and
 * still lands in one slot; a table entry no test matches is ignored. Nothing reads other runs
 * at CI time.
 *
 * `update` rewrites one suite and system from Playwright JSON reports -- the per-slot reports
 * CI uploads -- replacing that part entirely, so renamed tests drop out, and measures the wall
 * factor from the same reports. The file is written sorted: the same reports give the same bytes.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DURATIONS = join(ROOT, "tests", "playwright", "durations.json");
export const SUITES = {
  product: { config: "playwright.config.ts" },
  design: { config: "playwright.design.config.ts" },
};
const SUITE_ORDER = ["product", "design"];
export const SYSTEMS = ["linux", "windows", "macos"];
const SEPARATOR = " › ";
// The estimate for a test when the table is empty: about a short product test.
const FALLBACK_MS = 1000;

export class ShardError extends Error {}

/** Every test of a Playwright JSON report (`--list` or a run), with its duration if it ran. */
export function testsFromReport(report) {
  const tests = [];
  const walk = (suite, titles, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const path = [...titles, spec.title];
        const durations = (test.results ?? []).map((result) => result.duration);
        tests.push({
          id: testId(test.projectName, spec.file ?? file, path),
          project: test.projectName,
          file: spec.file ?? file,
          titles: path,
          duration: durations.length ? durations.reduce((a, b) => a + b, 0) : undefined,
        });
      }
    }
    for (const child of suite.suites ?? [])
      walk(child, [...titles, child.title], child.file ?? file);
  };
  // The outermost suites are files; their title is the path, not part of the title path.
  for (const file of report.suites ?? []) walk(file, [], file.file);
  return tests;
}

/** The line `--test-list` reads: `[project] › file › title › title`. */
export function testId(project, file, titles) {
  for (const part of [project, file, ...titles]) {
    if (typeof part !== "string" || part.includes("›") || part !== part.trim() || part === "") {
      throw new ShardError(
        `cannot name ${JSON.stringify([project, file, ...titles])} in a test list: ` +
          "a part is empty, carries outer spaces or contains ›",
      );
    }
  }
  return [`[${project}]`, file, ...titles].join(SEPARATOR);
}

/** Playwright's own rule (loadTestList): same project and file, the line's titles a prefix. */
export function lineSelects(line, test) {
  const tokens = line.split("›").map((token) => token.trim());
  const project = tokens[0].slice(1, -1);
  const [file, ...titles] = tokens.slice(1);
  return (
    project === test.project &&
    file === test.file &&
    titles.length <= test.titles.length &&
    titles.every((title, index) => title === test.titles[index])
  );
}

/** The duration table for one suite and system: its own, or the first system that has one. */
export function tableFor(durations, suite, os) {
  const tables = durations.suites?.[suite] ?? {};
  for (const system of [os, ...SYSTEMS]) {
    if (tables[system] && Object.keys(tables[system]).length) {
      return { system, table: tables[system] };
    }
  }
  return { system: null, table: {} };
}

/** Wall ms per table ms for a suite on a system; 1 when never measured. */
export function wallFactor(durations, suite, os) {
  return durations.wallFactor?.[suite]?.[os] ?? 1;
}

function median(values) {
  if (!values.length) return FALLBACK_MS;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Assigns every id to exactly one of `slots` slots, longest first onto the slot with the least
 * work. `loads` is the wall ms each slot already carries; `maxTests` caps a slot's count of
 * this suite; `factor` turns table ms into wall ms. Every slot gets at least one test.
 */
export function assign(ids, table, slots, { loads = [], maxTests = Infinity, factor = 1 } = {}) {
  if (!Number.isInteger(slots) || slots < 1)
    throw new ShardError("slots must be a positive integer");
  if (new Set(ids).size !== ids.length) throw new ShardError("the test list names a test twice");
  if (ids.length < slots) throw new ShardError(`${ids.length} tests cannot fill ${slots} slots`);
  if (ids.length > slots * maxTests) {
    throw new ShardError(`${ids.length} tests do not fit ${slots} slots of at most ${maxTests}`);
  }
  const estimate = median(Object.values(table));
  const weighted = ids.map((id) => ({
    id,
    ms: (table[id] ?? estimate) * factor,
    known: id in table,
  }));
  weighted.sort((a, b) => b.ms - a.ms || byId(a, b));
  const result = Array.from({ length: slots }, (_, index) => ({
    tests: [],
    ms: 0,
    before: loads[index] ?? 0,
  }));
  for (const test of weighted) {
    let best = null;
    for (const slot of result) {
      if (slot.tests.length >= maxTests) continue;
      if (!best || slot.before + slot.ms < best.before + best.ms) best = slot;
    }
    best.tests.push(test);
    best.ms += test.ms;
  }
  // A slot the other work already fills would get nothing, and Playwright 1.61 exits 0 with
  // no output for a test list that selects no test, so the slot would pass without running
  // anything. Give it the shortest test of the slot that holds the most.
  for (const slot of result) {
    if (slot.tests.length) continue;
    const donor = result.reduce((a, b) => (b.tests.length > a.tests.length ? b : a));
    const shortest = donor.tests.at(-1);
    donor.tests.pop();
    donor.ms -= shortest.ms;
    slot.tests.push(shortest);
    slot.ms += shortest.ms;
  }
  return result.map((slot) => ({
    ids: slot.tests.map((test) => test.id).sort(),
    ms: slot.ms,
    estimated: slot.tests.filter((test) => !test.known).length,
  }));
}

/** Errors when the slots do not hold every id exactly once. */
export function partitionErrors(ids, slots) {
  const seen = new Map();
  const errors = [];
  for (const [index, slot] of slots.entries()) {
    for (const id of slot) {
      if (seen.has(id)) errors.push(`${id} is in slot ${seen.get(id) + 1} and slot ${index + 1}`);
      else seen.set(id, index);
    }
  }
  const all = new Set(ids);
  for (const id of all) if (!seen.has(id)) errors.push(`${id} is in no slot`);
  for (const id of seen.keys()) if (!all.has(id)) errors.push(`${id} is not in the suite`);
  return errors;
}

/** Errors when the lines would make Playwright select anything but `expected` out of `tests`. */
export function selectionErrors(lines, tests, expected) {
  const want = new Set(expected);
  const errors = [];
  for (const test of tests) {
    const selected = lines.some((line) => lineSelects(line, test));
    if (selected && !want.has(test.id))
      errors.push(`${test.id} would run although assigned elsewhere`);
    if (!selected && want.has(test.id)) errors.push(`${test.id} would not run`);
  }
  return errors;
}

/**
 * Assigns both suites to the slots of one system. `suites` maps a suite to its tests, in the
 * order they run; `offsets` is each slot's other work in ms. Throws unless every suite is a
 * partition of its tests.
 */
export function planSlots(suites, durations, { os, slots, offsets = [], maxTests = Infinity }) {
  const loads = Array.from({ length: slots }, (_, index) => offsets[index] ?? 0);
  const plan = {};
  for (const suite of SUITE_ORDER.filter((name) => suites[name])) {
    const ids = suites[suite].map((test) => test.id);
    const { system, table } = tableFor(durations, suite, os);
    const factor = wallFactor(durations, suite, os);
    const assigned = assign(ids, table, slots, { loads, maxTests, factor });
    const errors = partitionErrors(
      ids,
      assigned.map((slot) => slot.ids),
    );
    if (errors.length) {
      throw new ShardError(`the ${suite} assignment is not a partition:\n${errors.join("\n")}`);
    }
    for (const [index, slot] of assigned.entries()) loads[index] += slot.ms;
    plan[suite] = { system, factor, slots: assigned };
  }
  return { plan, loads };
}

function minutes(ms) {
  return (ms / 60000).toFixed(1);
}

export function formatPlan({ plan, loads }, { os, offsets = [] }) {
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  const lines = [];
  for (const [suite, { system, factor, slots }] of Object.entries(plan)) {
    const count = slots.reduce((sum, slot) => sum + slot.ids.length, 0);
    lines.push(
      `${suite} on ${os}: ${count} tests, durations from ${system ?? "nowhere"}, wall factor ${factor}`,
    );
  }
  for (const [index, load] of loads.entries()) {
    const parts = Object.entries(plan).map(
      ([suite, { slots }]) =>
        `${suite} ${slots[index].ids.length} tests ${minutes(slots[index].ms)} min` +
        (slots[index].estimated ? ` (${slots[index].estimated} estimated)` : ""),
    );
    if (offsets[index]) parts.push(`other ${minutes(offsets[index])} min`);
    const deviation = (((load - mean) / mean) * 100).toFixed(1);
    lines.push(
      `  slot ${index + 1}: ${minutes(load)} min, ${deviation}% from the mean; ${parts.join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function readDurations(path = DURATIONS) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The table with one suite and system replaced by the tests these reports ran, and its wall
 * factor measured from them: the reports' wall time over the sum of their test durations.
 */
export function updateDurations(durations, suite, os, reports) {
  if (!SUITES[suite]) throw new ShardError(`unknown suite ${suite}`);
  if (!SYSTEMS.includes(os)) throw new ShardError(`unknown system ${os}`);
  const measured = {};
  let wall = 0;
  let summed = 0;
  for (const report of reports) {
    let reportSum = 0;
    for (const test of testsFromReport(report)) {
      if (test.duration === undefined) continue;
      if (test.id in measured) throw new ShardError(`${test.id} ran in two reports`);
      measured[test.id] = Math.round(test.duration);
      reportSum += test.duration;
    }
    if (typeof report.stats?.duration === "number" && reportSum > 0) {
      wall += report.stats.duration;
      summed += reportSum;
    }
  }
  if (!Object.keys(measured).length) throw new ShardError("the reports contain no test that ran");
  const suites = structuredClone(durations.suites ?? {});
  suites[suite] = { ...(suites[suite] ?? {}), [os]: measured };
  const factors = structuredClone(durations.wallFactor ?? {});
  if (summed > 0)
    factors[suite] = { ...(factors[suite] ?? {}), [os]: Number((wall / summed).toFixed(3)) };
  return { ...durations, suites: sortDeep(suites), wallFactor: sortDeep(factors) };
}

function sortDeep(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function formatDurations(durations) {
  return `${JSON.stringify(durations, null, 2)}\n`;
}

/** Lists a suite with Playwright; `testList` narrows it the way the slot's run will. */
export function listSuite(suite, testList) {
  const cli = join(ROOT, "node_modules", "playwright", "cli.js");
  const args = [cli, "test", "--config", SUITES[suite].config, "--list", "--reporter=json"];
  if (testList) args.push("--test-list", testList);
  const env = { ...process.env };
  // These would send the listing into a file instead of stdout.
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  const listed = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    throw new ShardError(`listing the ${suite} suite failed:\n${listed.stderr || listed.stdout}`);
  }
  return JSON.parse(listed.stdout);
}

function parseArgs(argv) {
  const options = { files: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith("--")) options[arg.slice(2)] = argv[++index];
    else options.files.push(arg);
  }
  return options;
}

/** `--offset 1=186000,2=0`: ms a slot spends on other work, such as the unit tests. */
export function parseOffsets(text = "") {
  const offsets = [];
  for (const part of text.split(",").filter(Boolean)) {
    const [slot, ms] = part.split("=").map(Number);
    if (!Number.isInteger(slot) || slot < 1 || !Number.isFinite(ms) || ms < 0) {
      throw new ShardError(`malformed offset ${part}; expected <slot>=<ms>`);
    }
    offsets[slot - 1] = ms;
  }
  return Array.from(offsets, (ms) => ms ?? 0);
}

function slotOptions(options) {
  if (!SYSTEMS.includes(options.os))
    throw new ShardError(`--os must be one of ${SYSTEMS.join(", ")}`);
  const slots = Number(options.slots);
  if (!Number.isInteger(slots) || slots < 1)
    throw new ShardError("--slots must be a positive integer");
  const maxTests = options["max-tests"] === undefined ? Infinity : Number(options["max-tests"]);
  if (!(maxTests >= 1)) throw new ShardError("--max-tests must be a positive number");
  return { os: options.os, slots, offsets: parseOffsets(options.offset), maxTests };
}

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const options = parseArgs(rest);
  if (command === "update") {
    if (!options.files.length) throw new ShardError("update needs at least one JSON report");
    const reports = options.files.map((file) => JSON.parse(readFileSync(file, "utf8")));
    const updated = updateDurations(readDurations(), options.suite, options.os, reports);
    writeFileSync(DURATIONS, formatDurations(updated));
    const count = Object.keys(updated.suites[options.suite][options.os]).length;
    const factor = updated.wallFactor?.[options.suite]?.[options.os];
    console.log(
      `durations: ${options.suite} on ${options.os} holds ${count} tests, wall factor ${factor}`,
    );
    return 0;
  }
  if (command !== "plan" && command !== "select") {
    throw new ShardError("usage: test-shards.mjs select|plan|update ...");
  }
  const slot = slotOptions(options);
  const listings = {};
  for (const suite of SUITE_ORDER) {
    const given = options[`list-${suite}`];
    listings[suite] = testsFromReport(
      given ? JSON.parse(readFileSync(given, "utf8")) : listSuite(suite),
    );
  }
  const result = planSlots(listings, readDurations(), slot);
  console.log(formatPlan(result, slot));
  if (command === "plan") return 0;

  const index = Number(options.slot) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= slot.slots) {
    throw new ShardError(`--slot must be between 1 and ${slot.slots}`);
  }
  if (!options["out-dir"]) throw new ShardError("select needs --out-dir <directory>");
  mkdirSync(options["out-dir"], { recursive: true });
  for (const suite of SUITE_ORDER) {
    const mine = result.plan[suite].slots[index].ids;
    const statical = selectionErrors(mine, listings[suite], mine);
    if (statical.length) {
      throw new ShardError(`the ${suite} test list would select wrongly:\n${statical.join("\n")}`);
    }
    const file = join(options["out-dir"], `${suite}.txt`);
    writeFileSync(file, `${mine.join("\n")}\n`);
    // Ask Playwright itself: the file must select exactly this slot's tests.
    const selected = testsFromReport(listSuite(suite, file)).map((test) => test.id);
    const errors = partitionErrors(mine, [selected]);
    if (errors.length) {
      throw new ShardError(
        `Playwright selects other ${suite} tests than assigned:\n${errors.join("\n")}`,
      );
    }
    console.log(
      `slot ${index + 1}: Playwright selects exactly the ${mine.length} assigned ${suite} tests`,
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (!(error instanceof ShardError)) throw error;
    console.error(`test-shards: ${error.message}`);
    process.exitCode = 1;
  }
}
