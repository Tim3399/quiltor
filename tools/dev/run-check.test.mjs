import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  defaultJobs,
  exitCode,
  formatPrelude,
  formatReport,
  LINKS,
  planPrelude,
  RUST_LINKS,
  RUST_PRELUDE,
  runCheck,
  runLinks,
} from "./run-check.mjs";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
);

// The chain `check` was before it became a runner: v3.22.1, 17 links.
const FORMER_CHAIN = [
  "check:contracts",
  "check:architecture",
  "check:design",
  "check:design-system",
  "check:i18n",
  "check:platform",
  "lint:biome",
  "lint:eslint",
  "check:format",
  "lint:ruff",
  "lint:pyright",
  "lint:zizmor",
  "lint:stylelint",
  "lint:markdown",
  "lint:knip",
  "lint:typos",
  "test:audit-tools",
];

const fake =
  (reds = {}) =>
  async (link) =>
    link in reds ? { code: 1, output: `${link} broke\n` } : { code: 0, output: `${link} fine\n` };

test("runs every link and reports all green", async () => {
  const links = ["a", "b", "c"];
  const results = await runLinks(links, fake(), 2);
  assert.deepEqual(
    results.map((r) => r.link),
    links,
  );
  assert.ok(results.every((r) => r.code === 0));
  assert.match(formatReport(results, 1500), /all 3 links green \(1\.5s\)/);
});

test("one red link is named and its output is shown", async () => {
  const results = await runLinks(["a", "b", "c"], fake({ b: 1 }), 3);
  const report = formatReport(results, 0);
  assert.match(report, /=== b -- FAILED/);
  assert.match(report, /b broke/);
  assert.doesNotMatch(report, /a fine/);
  assert.match(report, /1 of 3 links red.*: b$/);
  assert.equal(exitCode(results), 1);
});

test("several red links are all reported, in link order", async () => {
  const results = await runLinks(["a", "b", "c", "d"], fake({ d: 1, b: 1 }), 4);
  const report = formatReport(results, 0);
  assert.match(report, /2 of 4 links red.*: b, d$/);
  assert.ok(report.indexOf("b broke") < report.indexOf("d broke"));
});

test("a link that throws counts as red", async () => {
  const results = await runLinks(
    ["a"],
    async () => {
      throw new Error("spawn failed");
    },
    1,
  );
  assert.equal(results[0].code, 1);
  assert.match(formatReport(results, 0), /spawn failed/);
});

test("never runs more links at once than allowed", async () => {
  let running = 0;
  let peak = 0;
  const run = async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return { code: 0, output: "" };
  };
  await runLinks(["a", "b", "c", "d", "e", "f"], run, 2);
  assert.equal(peak, 2);
});

test("QUILTOR_CHECK_JOBS overrides the default job count", () => {
  assert.equal(defaultJobs({ QUILTOR_CHECK_JOBS: "3" }), 3);
  assert.ok(defaultJobs({}) >= 1);
});

test("LINKS are the former chain, each exactly once", () => {
  assert.deepEqual(LINKS, FORMER_CHAIN);
  assert.equal(new Set(LINKS).size, LINKS.length);
});

test("package.json: `check` is the runner and every link is an npm script", () => {
  assert.equal(pkg.scripts.check, "node tools/dev/run-check.mjs");
  for (const link of LINKS) assert.ok(pkg.scripts[link], `missing npm script ${link}`);
});

// ---- the Rust prelude (T-76) ----

// Records the order of events: the prelude step and every link.
function recorder({ stepOutcome = { code: 0, output: "" } } = {}) {
  const events = [];
  return {
    events,
    runStep: async (step) => {
      events.push(`step:start:${step.command}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`step:end:${step.command}`);
      return stepOutcome;
    },
    runLink: async (link) => {
      events.push(`link:${link}`);
      return { code: 0, output: "" };
    },
  };
}

test("prelude runs once, and finishes before any link starts, when a cargo link is selected", async () => {
  const rec = recorder();
  const { prelude, results } = await runCheck(["lint:biome", ...RUST_LINKS, "lint:ruff"], {
    ...rec,
    jobs: 3,
  });
  assert.equal(prelude.length, 1);
  assert.equal(results.length, 3);
  assert.deepEqual(rec.events.slice(0, 2), ["step:start:rustup", "step:end:rustup"]);
  assert.equal(rec.events.filter((event) => event.startsWith("step:start")).length, 1);
});

test("the prelude installs the pinned toolchain through rustup", () => {
  assert.equal(RUST_PRELUDE.command, "rustup");
  // No toolchain argument: rust-toolchain.toml decides, components included.
  assert.deepEqual(RUST_PRELUDE.args, ["toolchain", "install", "--no-self-update"]);
  assert.deepEqual(planPrelude(LINKS), [RUST_PRELUDE]);
});

test("no prelude without a cargo link", async () => {
  const rec = recorder();
  const links = LINKS.filter((link) => !RUST_LINKS.includes(link));
  const { prelude, results } = await runCheck(links, { ...rec, jobs: 3 });
  assert.deepEqual(prelude, []);
  assert.equal(results.length, links.length);
  assert.ok(rec.events.every((event) => event.startsWith("link:")));
});

test("a red prelude makes the check red and no link runs", async () => {
  const rec = recorder({
    stepOutcome: { code: 1, output: "error: failed to install component\n" },
  });
  const { prelude, results, aborted } = await runCheck(LINKS, { ...rec, jobs: 3 });
  assert.equal(aborted, true);
  assert.deepEqual(results, []);
  assert.deepEqual(rec.events, ["step:start:rustup", "step:end:rustup"]);
  assert.equal(exitCode(results, prelude), 1);
  const report = formatPrelude(prelude);
  assert.match(report, /prelude: rust toolchain -- FAILED/);
  assert.match(report, /failed to install component/);
  assert.match(report, /no link was run/);
});

test("a prelude that throws is red as well", async () => {
  const { prelude, results } = await runCheck(LINKS, {
    runLink: async () => ({ code: 0, output: "" }),
    runStep: async () => {
      throw new Error("spawn exploded");
    },
    jobs: 2,
  });
  assert.deepEqual(results, []);
  assert.equal(exitCode(results, prelude), 1);
  assert.match(formatPrelude(prelude), /spawn exploded/);
});

test("without rustup the links run as before and the check stays green", async () => {
  const rec = recorder({
    stepOutcome: { code: 1, missing: true, output: "spawn rustup ENOENT\n" },
  });
  const { prelude, results, aborted } = await runCheck(LINKS, { ...rec, jobs: 3 });
  assert.equal(aborted, false);
  assert.equal(results.length, LINKS.length);
  assert.equal(exitCode(results, prelude), 0);
  assert.match(formatPrelude(prelude), /skipped \(rustup not found\)/);
});

test("RUST_LINKS lists exactly the links that reach cargo or rustc through the npm scripts", () => {
  const reaches = (script, seen = new Set()) => {
    const body = pkg.scripts[script];
    if (body === undefined || seen.has(script)) return false;
    seen.add(script);
    if (/\b(cargo|rustc|rustup)\b/u.test(body)) return true;
    return [...body.matchAll(/npm run ([\w:-]+)/gu)].some((match) => reaches(match[1], seen));
  };
  assert.deepEqual(
    LINKS.filter((link) => reaches(link)),
    LINKS.filter((link) => RUST_LINKS.includes(link)),
  );
  assert.ok(RUST_LINKS.every((link) => LINKS.includes(link)));
});
