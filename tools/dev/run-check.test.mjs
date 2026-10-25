import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultJobs, exitCode, formatReport, LINKS, runLinks } from "./run-check.mjs";

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
