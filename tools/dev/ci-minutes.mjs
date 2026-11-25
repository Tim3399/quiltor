// Where the CI minutes go (T-341): every job of every run in a time window, summed per
// operating system, workflow, trigger, job and attempt, in Linux-equivalent minutes. Read-only
// through `gh api`; it never starts, reruns or cancels anything.
//
//   node tools/dev/ci-minutes.mjs --days 30
//   node tools/dev/ci-minutes.mjs --days 7 --json > minutes.json
//   node tools/dev/ci-minutes.mjs --from-file jobs.json      (a saved --dump, no network)
//
// GitHub bills each job rounded up to a whole minute and counts Windows minutes twice and
// macOS minutes ten times; "L-min" here is that billed number. A rerun is every attempt after
// the first; a job that "Re-run failed jobs" only carries over counts once, in the attempt that
// ran it (F-341-11). The red-run count ignores the gate job browser-e2e, which runs on Linux and turns
// red whenever any required job does (F-341-1).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** How many Linux minutes one minute on each runner costs. */
export const MULTIPLIER = { linux: 1, windows: 2, macos: 10 };
/** The gate job: red whenever another required job is. */
export const GATE_JOB = "browser-e2e";

/** The operating system of a job, from its runner labels. */
export function osOf(labels = []) {
  const text = labels.join(" ").toLowerCase();
  if (text.includes("windows")) return "windows";
  if (text.includes("macos")) return "macos";
  return "linux";
}

/** Billed minutes of one job: rounded up to a whole minute, at least one; null if it never ran. */
export function billedMinutes(job) {
  if (!job.started || !job.completed || job.conclusion === "skipped") return null;
  const minutes = (Date.parse(job.completed) - Date.parse(job.started)) / 60000;
  return Math.max(1, Math.ceil(minutes));
}

/** Matrix legs of one job collapse into one row: "slot 3 of 6" becomes "slot * of 6". */
export function jobKey(name) {
  return name
    .replace(/slot \d+ of (\d+)/, "slot * of $1")
    .replace(/ on (windows|macos)-[0-9.]+/, " on $1");
}

/**
 * Sums jobs (one entry per job and attempt, as `collect` returns them). Each group maps a key
 * to { jobs, minutes, lmin }.
 */
export function summarize(jobs) {
  const groups = { os: {}, workflow: {}, trigger: {}, job: {}, attempt: {} };
  const total = { jobs: 0, minutes: 0, lmin: 0 };
  const add = (group, key, minutes, lmin) => {
    groups[group][key] ??= { jobs: 0, minutes: 0, lmin: 0 };
    const entry = groups[group][key];
    entry.jobs += 1;
    entry.minutes += minutes;
    entry.lmin += lmin;
  };
  for (const job of jobs) {
    const minutes = billedMinutes(job);
    if (minutes === null) continue;
    const os = osOf(job.labels);
    const lmin = minutes * MULTIPLIER[os];
    total.jobs += 1;
    total.minutes += minutes;
    total.lmin += lmin;
    add("os", os, minutes, lmin);
    add("workflow", job.workflow, minutes, lmin);
    add("trigger", `${job.workflow} / ${job.event}`, minutes, lmin);
    add("job", `${job.workflow} :: ${jobKey(job.name)}`, minutes, lmin);
    add("attempt", job.attempt > 1 ? "rerun" : "first attempt", minutes, lmin);
  }
  return { total, groups };
}

/**
 * Red attempts of one workflow, by where they were red, without the gate job: how many had a
 * red Linux job and how many were red only on Windows or macOS.
 */
export function redAttempts(jobs, workflow = "Test") {
  const red = new Map();
  for (const job of jobs) {
    if (job.workflow !== workflow || job.conclusion !== "failure" || job.name === GATE_JOB)
      continue;
    const key = `${job.run}#${job.attempt}`;
    if (!red.has(key)) red.set(key, new Set());
    red.get(key).add(osOf(job.labels));
  }
  const attempts = [...red.values()];
  const withLinux = attempts.filter((systems) => systems.has("linux")).length;
  return { red: attempts.length, withLinux, otherOnly: attempts.length - withLinux };
}

/** The summary as Markdown tables, largest first. */
export function renderTables({ total, groups }, red, { top = 30 } = {}) {
  const share = (lmin) => (total.lmin ? ((100 * lmin) / total.lmin).toFixed(1) : "0.0");
  const lines = [
    `${total.jobs} jobs, ${total.minutes} billed minutes, ${total.lmin} L-min`,
    "",
    `Red attempts of Test without ${GATE_JOB}: ${red.red}, with a red Linux job ${red.withLinux}, red only on Windows or macOS ${red.otherOnly}`,
  ];
  const titles = {
    os: "Operating system",
    workflow: "Workflow",
    trigger: "Workflow / trigger",
    attempt: "Attempt",
    job: `Job (top ${top})`,
  };
  for (const [group, title] of Object.entries(titles)) {
    const rows = Object.entries(groups[group]).sort((a, b) => b[1].lmin - a[1].lmin);
    lines.push(
      "",
      `## ${title}`,
      "",
      "| Key | Jobs | Minutes | L-min | Share |",
      "|---|---|---|---|---|",
    );
    for (const [key, entry] of group === "job" ? rows.slice(0, top) : rows) {
      lines.push(
        `| ${key} | ${entry.jobs} | ${entry.minutes} | ${entry.lmin} | ${share(entry.lmin)} % |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Drops the jobs a later attempt only carries over. "Re-run failed jobs" lists the jobs it did
 * not repeat again under the new attempt, with a new id but the same name, start and end; they
 * ran once and are billed once, in the attempt that really ran them (F-341-11).
 */
export function withoutCarriedOver(jobs) {
  const firstSeen = new Map();
  return jobs.filter((job) => {
    const key = `${job.run}|${job.name}|${job.started}|${job.completed}`;
    const first = firstSeen.get(key);
    if (first === undefined) {
      firstSeen.set(key, job.attempt);
      return true;
    }
    return first === job.attempt;
  });
}

/** Every job of every run since `since` (YYYY-MM-DD), every attempt, through `gh api`. */
export function collect({ repo, since, api = ghApi }) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const batch = api(`repos/${repo}/actions/runs?per_page=100&page=${page}&created=>=${since}`);
    runs.push(...batch.workflow_runs);
    if (batch.workflow_runs.length < 100) break;
  }
  const jobs = [];
  for (const run of runs) {
    for (let attempt = 1; attempt <= run.run_attempt; attempt += 1) {
      for (let page = 1; ; page += 1) {
        const batch = api(
          `repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
        );
        for (const job of batch.jobs) {
          jobs.push({
            run: run.id,
            workflow: run.name,
            event: run.event,
            attempt,
            name: job.name,
            labels: job.labels,
            conclusion: job.conclusion,
            started: job.started_at,
            completed: job.completed_at,
          });
        }
        if (batch.jobs.length < 100) break;
      }
    }
  }
  return withoutCarriedOver(jobs);
}

/** One API answer. A server error (5xx) is tried again up to five times, 5 to 25 seconds apart:
 * a 30-day window is several thousand calls, and one 502 should not cost the whole count. */
function ghApi(path) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = execFileSync(
        "gh",
        ["api", "-H", "Accept: application/vnd.github+json", path],
        { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] },
      );
      return JSON.parse(output.toString());
    } catch (error) {
      const serverError = /HTTP 5\d\d/.test(String(error.stderr ?? ""));
      if (!serverError || attempt > 5) throw error;
      process.stderr.write(`retrying after a server error (${attempt}/5): ${path}\n`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
    }
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "30" },
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      dump: { type: "boolean", default: false },
      "from-file": { type: "string" },
      top: { type: "string", default: "30" },
    },
  });
  let jobs;
  if (values["from-file"]) {
    jobs = withoutCarriedOver(JSON.parse(readFileSync(values["from-file"], "utf8")));
  } else {
    const repo =
      values.repo ??
      execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
        .toString()
        .trim();
    const since = new Date(Date.now() - Number(values.days) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    jobs = collect({ repo, since });
  }
  if (values.dump) return process.stdout.write(`${JSON.stringify(jobs)}\n`);
  const summary = summarize(jobs);
  const red = redAttempts(jobs);
  if (values.json) return process.stdout.write(`${JSON.stringify({ ...summary, red }, null, 2)}\n`);
  process.stdout.write(renderTables(summary, red, { top: Number(values.top) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
