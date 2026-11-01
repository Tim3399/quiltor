import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assign,
  formatDurations,
  lineSelects,
  listSuite,
  parseOffsets,
  partitionErrors,
  planSlots,
  readDurations,
  selectionErrors,
  ShardError,
  testId,
  testsFromReport,
  updateDurations,
} from "./test-shards.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/test.yml", import.meta.url)),
  "utf8",
);

function report(specs, stats) {
  // One file suite, optionally one describe level, as Playwright's JSON reporter writes it.
  const suite = { title: "a.spec.ts", file: "a.spec.ts", specs: [], suites: [] };
  for (const { title, project = "wide", duration, describe } of specs) {
    const spec = {
      title,
      file: "a.spec.ts",
      tests: [{ projectName: project, results: duration === undefined ? [] : [{ duration }] }],
    };
    if (describe) {
      let group = suite.suites.find((child) => child.title === describe);
      if (!group) {
        group = { title: describe, file: "a.spec.ts", specs: [], suites: [] };
        suite.suites.push(group);
      }
      group.specs.push(spec);
    } else {
      suite.specs.push(spec);
    }
  }
  return { stats, suites: [suite] };
}

test("tests from a report carry project, file and the describe path", () => {
  const tests = testsFromReport(
    report([{ title: "B", describe: "A", duration: 12 }, { title: "C" }]),
  );
  assert.deepEqual(
    tests.map(({ id, duration }) => [id, duration]),
    [
      ["[wide] › a.spec.ts › C", undefined],
      ["[wide] › a.spec.ts › A › B", 12],
    ],
  );
});

test("a title the test list format cannot carry is refused", () => {
  assert.throws(() => testId("wide", "a.spec.ts", ["x › y"]), ShardError);
  assert.throws(() => testId("wide", "a.spec.ts", ["padded "]), ShardError);
});

test("every test lands in exactly one slot, longest first onto the lightest", () => {
  const table = { a: 50, b: 40, c: 30, d: 20, e: 10 };
  const slots = assign(Object.keys(table), table, 2);
  assert.deepEqual(
    slots.map((slot) => [slot.ids, slot.ms]),
    [
      [["a", "d", "e"], 80],
      [["b", "c"], 70],
    ],
  );
  assert.deepEqual(
    partitionErrors(
      Object.keys(table),
      slots.map((slot) => slot.ids),
    ),
    [],
  );
});

test("a test missing from the table still lands in exactly one slot, at the median", () => {
  const table = { a: 50, b: 40, c: 30 };
  const ids = ["a", "b", "c", "new"];
  const slots = assign(ids, table, 2);
  assert.deepEqual(
    partitionErrors(
      ids,
      slots.map((slot) => slot.ids),
    ),
    [],
  );
  assert.equal(
    slots.reduce((sum, slot) => sum + slot.estimated, 0),
    1,
  );
  assert.equal(
    slots.reduce((sum, slot) => sum + slot.ms, 0),
    50 + 40 + 30 + 40,
  );
});

test("a table entry no test matches is ignored", () => {
  const slots = assign(["a", "b"], { a: 5, b: 5, gone: 1_000_000 }, 2);
  assert.deepEqual(
    slots.map((slot) => slot.ids),
    [["a"], ["b"]],
  );
});

test("other work counts, and a slot it fills still gets a test", () => {
  const table = { a: 10, b: 10, c: 10, d: 10 };
  const slots = assign(Object.keys(table), table, 2, { loads: [1000, 0] });
  assert.ok(slots.every((slot) => slot.ids.length >= 1));
  assert.deepEqual(
    partitionErrors(
      Object.keys(table),
      slots.map((slot) => slot.ids),
    ),
    [],
  );
});

test("the test cap holds even where the durations would pile up", () => {
  const ids = Array.from({ length: 10 }, (_, index) => `t${index}`);
  const table = Object.fromEntries(ids.map((id, index) => [id, index === 0 ? 1000 : 1]));
  const slots = assign(ids, table, 2, { maxTests: 6 });
  assert.ok(slots.every((slot) => slot.ids.length <= 6));
  assert.throws(() => assign(ids, table, 2, { maxTests: 4 }), /do not fit/);
});

test("the assignment is deterministic", () => {
  const table = { a: 10, b: 10, c: 10, d: 10, e: 10 };
  const first = assign(Object.keys(table), table, 3);
  const second = assign(Object.keys(table).reverse(), table, 3);
  assert.deepEqual(first, second);
});

test("a dropped or doubled test is a partition error", () => {
  const ids = ["a", "b", "c"];
  assert.match(partitionErrors(ids, [["a"], ["b"]]).join("\n"), /c is in no slot/);
  assert.match(
    partitionErrors(ids, [
      ["a", "c"],
      ["b", "c"],
    ]).join("\n"),
    /c is in slot 1 and slot 2/,
  );
  assert.match(partitionErrors(ids, [["a", "b", "c", "x"]]).join("\n"), /x is not in the suite/);
});

test("a line selects as Playwright reads it: project, file, title prefix", () => {
  const [inner] = testsFromReport(report([{ title: "B", describe: "A" }]));
  assert.ok(lineSelects("[wide] › a.spec.ts › A › B", inner));
  assert.ok(lineSelects("[wide] › a.spec.ts › A", inner));
  assert.ok(!lineSelects("[compact] › a.spec.ts › A › B", inner));
  assert.ok(!lineSelects("[wide] › b.spec.ts › A › B", inner));
});

test("a line that would also select another slot's test is caught", () => {
  // A test titled like a describe block: its line is a prefix of the block's tests.
  const tests = testsFromReport(report([{ title: "A" }, { title: "B", describe: "A" }]));
  const [outer, inner] = tests.map((t) => t.id);
  assert.match(selectionErrors([outer], tests, [outer]).join("\n"), /would run although assigned/);
  assert.deepEqual(selectionErrors([inner], tests, [inner]), []);
});

test("update replaces one suite and system, sorted, with the measured wall factor", () => {
  const before = {
    schemaVersion: 1,
    suites: { product: { linux: { old: 1 }, windows: { kept: 2 } } },
  };
  const reports = [
    report(
      [
        { title: "b", duration: 300 },
        { title: "a", duration: 100 },
      ],
      { duration: 200 },
    ),
  ];
  const after = updateDurations(before, "product", "linux", reports);
  assert.deepEqual(after.suites.product.linux, {
    "[wide] › a.spec.ts › a": 100,
    "[wide] › a.spec.ts › b": 300,
  });
  assert.deepEqual(after.suites.product.windows, { kept: 2 });
  assert.equal(after.wallFactor.product.linux, 0.5);
  const again = updateDurations(before, "product", "linux", [...reports].reverse());
  assert.equal(formatDurations(after), formatDurations(again));
  assert.throws(
    () => updateDurations(before, "product", "linux", [...reports, ...reports]),
    /two reports/,
  );
});

test("offsets parse as slot=ms", () => {
  assert.deepEqual(parseOffsets("1=186000,3=5"), [186000, 0, 5]);
  assert.throws(() => parseOffsets("0=5"), ShardError);
});

/** The slot shapes the workflow passes to `select`, read from test.yml itself. */
function workflowShapes() {
  const linux = /select --os linux --slots (\d+) --slot "\$SLOT" (.*?) --out-dir/.exec(workflow);
  const [windowsArgs, macosArgs] = [...workflow.matchAll(/shape=\(([^)]*)\)/g)].map(
    (match) => match[1],
  );
  const count = (system) =>
    (workflow.match(new RegExp(`^ +system: ${system}$`, "gm")) ?? []).length;
  const shape = (os, slots, args) => {
    const words = args.split(" ").map((word) => word.replace(/^"(.*)"$/, "$1"));
    const value = (flag) => (words.includes(flag) ? words[words.indexOf(flag) + 1] : undefined);
    return {
      os,
      slots,
      offsets: parseOffsets(value("--offset")),
      maxTests: value("--max-tests") ? Number(value("--max-tests")) : Infinity,
    };
  };
  return [
    shape("linux", Number(linux[1]), linux[2]),
    shape("windows", count("windows"), windowsArgs),
    shape("macos", count("macos"), macosArgs),
  ];
}

test("the workflow names a slot shape for every system", () => {
  assert.deepEqual(
    workflowShapes().map(({ os, slots, maxTests }) => [os, slots, maxTests]),
    [
      ["linux", 4, Infinity],
      ["windows", 8, 100],
      ["macos", 3, Infinity],
    ],
  );
});

test("for the current suites every system's slots hold every test exactly once", () => {
  const suites = {
    product: testsFromReport(listSuite("product")),
    design: testsFromReport(listSuite("design")),
  };
  const durations = readDurations();
  for (const shape of workflowShapes()) {
    const { plan } = planSlots(suites, durations, shape);
    for (const [suite, tests] of Object.entries(suites)) {
      const slots = plan[suite].slots.map((slot) => slot.ids);
      assert.deepEqual(
        partitionErrors(
          tests.map((t) => t.id),
          slots,
        ),
        [],
        `${suite} on ${shape.os}`,
      );
      // And as Playwright will read the lists: each test selected by exactly one slot.
      for (const t of tests) {
        const selecting = slots.filter((lines) => lines.some((line) => lineSelects(line, t)));
        assert.equal(
          selecting.length,
          1,
          `${t.id} on ${shape.os} is selected ${selecting.length} times`,
        );
      }
      if (shape.maxTests !== Infinity) {
        assert.ok(
          slots.every((ids) => ids.length <= shape.maxTests),
          `${suite} on ${shape.os} over the cap`,
        );
      }
    }
  }
});
