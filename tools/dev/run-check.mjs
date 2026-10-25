import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { pathToFileURL } from "node:url";

/*
 * Runs the links of `npm run check` in parallel and reports them in a fixed order.
 *
 *   node tools/dev/run-check.mjs
 *
 * The links used to be one `&&` chain, so a red link hid every link behind it. Here every
 * link runs, its output is buffered, and the report comes at the end in the order of LINKS:
 * one header per link with status and duration, the output of the red ones, and a summary
 * naming all red links. The exit code is 1 when any link is red.
 *
 * Each link stays an npm script of its own (`npm run lint:knip`), so a single one can still
 * be run by hand. LINKS is the only place that lists them; run-check.test.mjs compares it
 * with the chain `check` used to be.
 *
 * Why they may run side by side: no link writes into the tree. The format links only
 * check (`biome format`, `ruff format --check`, `prettier --check`, `cargo fmt --check`),
 * ruff and biome do not fix, and the node --test links write nothing. The tools that keep
 * a cache (eslint, pyright, knip) each use their own directory. What is shared is the CPU,
 * which is why the number of simultaneous links is capped (QUILTOR_CHECK_JOBS overrides).
 */

export const LINKS = [
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

const MAX_JOBS = 6;

export function defaultJobs(env = process.env) {
  const asked = Number.parseInt(env.QUILTOR_CHECK_JOBS ?? "", 10);
  if (asked > 0) return asked;
  return Math.max(1, Math.min(MAX_JOBS, availableParallelism()));
}

/** Runs `run(link)` for every link with at most `jobs` at once; results keep the order of `links`. */
export async function runLinks(links, run, jobs) {
  const results = new Array(links.length);
  let next = 0;
  async function worker() {
    while (next < links.length) {
      const index = next++;
      const started = Date.now();
      let outcome;
      try {
        outcome = await run(links[index]);
      } catch (error) {
        outcome = { code: 1, output: `${error instanceof Error ? error.message : error}\n` };
      }
      results[index] = { link: links[index], ...outcome, ms: Date.now() - started };
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, links.length) }, worker));
  return results;
}

export function formatReport(results, totalMs) {
  const lines = [];
  for (const { link, code, output, ms } of results) {
    const status = code === 0 ? "ok" : "FAILED";
    lines.push(`=== ${link} -- ${status} (${seconds(ms)}) ===`);
    if (code !== 0 && output.trim() !== "") lines.push(output.replace(/\s+$/, ""));
  }
  const red = results.filter((result) => result.code !== 0);
  lines.push("");
  lines.push(
    red.length === 0
      ? `check: all ${results.length} links green (${seconds(totalMs)})`
      : `check: ${red.length} of ${results.length} links red (${seconds(totalMs)}): ${red.map((r) => r.link).join(", ")}`,
  );
  return lines.join("\n");
}

export function exitCode(results) {
  return results.some((result) => result.code !== 0) ? 1 : 0;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function runNpmScript(link) {
  return new Promise((resolve) => {
    const child = spawn(`npm run ${link}`, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) => resolve({ code: 1, output: `${error.message}\n` }));
    child.on("close", (code) =>
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") }),
    );
  });
}

async function main() {
  const started = Date.now();
  const results = await runLinks(LINKS, runNpmScript, defaultJobs());
  console.log(formatReport(results, Date.now() - started));
  process.exitCode = exitCode(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
