import assert from "node:assert/strict";
import test from "node:test";
import {
  billedMinutes,
  collect,
  jobKey,
  MULTIPLIER,
  osOf,
  redAttempts,
  renderTables,
  summarize,
} from "./ci-minutes.mjs";

/*
 * ci-minutes.mjs against fixed API answers: no network. The point under test is the billed
 * number -- minutes rounded up per job, Windows twice and macOS ten times -- and that reruns
 * and the gate job are counted the way the plan of T-341 reads them.
 */

const at = (minute, second = 0) =>
  `2026-11-01T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
const job = (name, labels, startMinute, endMinute, extra = {}) => ({
  name,
  labels,
  conclusion: "success",
  started_at: at(startMinute),
  completed_at: typeof endMinute === "number" ? at(endMinute) : endMinute,
  ...extra,
});

/** Two runs: Test with a rerun, Release Build once. */
function fakeApi(path) {
  if (path.includes("/actions/runs?")) {
    return {
      workflow_runs: [
        { id: 1, name: "Test", event: "workflow_dispatch", run_attempt: 2 },
        { id: 2, name: "Release Build", event: "push", run_attempt: 1 },
      ],
    };
  }
  const answers = {
    "runs/1/attempts/1/": [
      job("Browser E2E / slot 1 of 6", ["ubuntu-24.04"], 0, 3),
      // 2 min 10 s on Windows: three billed minutes, six L-min.
      job("Core on windows-2025", ["windows-2025"], 0, at(2, 10), { conclusion: "failure" }),
      job("Browser on macos-15 / slot 2 of 4", ["macos-15"], 0, 4, { conclusion: "failure" }),
      job("browser-e2e", ["ubuntu-24.04"], 5, 6, { conclusion: "failure" }),
      job("Smoke on macos-15", ["macos-15"], 0, null, { conclusion: "skipped" }),
    ],
    "runs/1/attempts/2/": [
      // Not repeated by "Re-run failed jobs": listed again with the times of attempt 1.
      job("Browser E2E / slot 1 of 6", ["ubuntu-24.04"], 0, 3),
      job("Core on windows-2025", ["windows-2025"], 0, at(2, 10), { conclusion: "failure" }),
      job("Browser on macos-15 / slot 2 of 4", ["macos-15"], 10, 12),
      job("Browser E2E / slot 2 of 6", ["ubuntu-24.04"], 10, 11, { conclusion: "failure" }),
    ],
    "runs/2/attempts/1/": [job("Full test matrix / Core on macos-15", ["macos-15"], 0, 0)],
  };
  const key = Object.keys(answers).find((part) => path.includes(part));
  assert.ok(key, `unexpected API path ${path}`);
  return { jobs: answers[key] };
}

const jobs = collect({ repo: "owner/repo", since: "2026-11-01", api: fakeApi });

test("collect walks every run and every attempt", () => {
  assert.equal(jobs.length, 8);
  assert.deepEqual(
    [...new Set(jobs.map((entry) => `${entry.run}#${entry.attempt}`))],
    ["1#1", "1#2", "2#1"],
  );
});

test("a job that a rerun only carries over is counted once, in the attempt that ran it", () => {
  const carried = collect({ repo: "owner/repo", since: "2026-11-01", api: fakeApi }).filter(
    (entry) => entry.run === 1 && entry.attempt === 2,
  );
  assert.deepEqual(
    carried.map((entry) => entry.name),
    ["Browser on macos-15 / slot 2 of 4", "Browser E2E / slot 2 of 6"],
  );
  const { total } = summarize(jobs);
  assert.equal(total.jobs, 7);
});

test("a job is billed rounded up to a whole minute, at least one, and only if it ran", () => {
  assert.equal(billedMinutes({ started: at(0), completed: at(2, 10) }), 3);
  assert.equal(billedMinutes({ started: at(0), completed: at(0) }), 1);
  assert.equal(billedMinutes({ started: at(0), completed: null }), null);
  assert.equal(billedMinutes({ started: at(0), completed: at(1), conclusion: "skipped" }), null);
});

test("Windows counts twice and macOS ten times a Linux minute", () => {
  assert.deepEqual(MULTIPLIER, { linux: 1, windows: 2, macos: 10 });
  assert.equal(osOf(["windows-2025"]), "windows");
  assert.equal(osOf(["macos-15"]), "macos");
  assert.equal(osOf(["ubuntu-24.04"]), "linux");
  const { total, groups } = summarize(jobs);
  // Linux 3 + 1 + 1, Windows 3, macOS 4 + 2 + 1.
  assert.deepEqual(groups.os.linux, { jobs: 3, minutes: 5, lmin: 5 });
  assert.deepEqual(groups.os.windows, { jobs: 1, minutes: 3, lmin: 6 });
  assert.deepEqual(groups.os.macos, { jobs: 3, minutes: 7, lmin: 70 });
  assert.deepEqual(total, { jobs: 7, minutes: 15, lmin: 81 });
});

test("every attempt after the first counts as a rerun", () => {
  const { groups } = summarize(jobs);
  assert.deepEqual(groups.attempt.rerun, { jobs: 2, minutes: 3, lmin: 21 });
  assert.deepEqual(groups.attempt["first attempt"], { jobs: 5, minutes: 12, lmin: 60 });
});

test("matrix legs collapse into one job row, per workflow and trigger", () => {
  assert.equal(jobKey("Browser E2E / slot 3 of 6"), "Browser E2E / slot * of 6");
  assert.equal(jobKey("Browser on macos-15 / slot 2 of 4"), "Browser on macos / slot * of 4");
  const { groups } = summarize(jobs);
  assert.equal(groups.job["Test :: Browser on macos / slot * of 4"].lmin, 60);
  assert.equal(groups.trigger["Release Build / push"].lmin, 10);
});

test("red attempts ignore the gate job, which turns red with any other job", () => {
  // Attempt 1: red on Windows and macOS, the Linux gate is red too but does not count.
  // Attempt 2: red on Linux.
  assert.deepEqual(redAttempts(jobs), { red: 2, withLinux: 1, otherOnly: 1 });
});

test("the tables carry the totals and the shares", () => {
  const text = renderTables(summarize(jobs), redAttempts(jobs));
  assert.match(text, /^7 jobs, 15 billed minutes, 81 L-min$/m);
  assert.match(text, /^\| macos \| 3 \| 7 \| 70 \| 86\.4 % \|$/m);
  assert.match(text, /red only on Windows or macOS 1$/m);
});
