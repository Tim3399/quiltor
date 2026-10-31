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
 *
 * One thing has to happen before they start: when rust-toolchain.toml names components the
 * installed toolchain lacks, the first cargo call has rustup add them. Two links doing that
 * at once collided (`detected conflict: 'bin/cargo-clippy'`, CI run 41190689350), so a serial
 * prelude -- `rustup toolchain install --no-self-update`, which installs the pinned toolchain with its
 * components -- runs once first, but only when a selected link needs cargo (RUST_LINKS).
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
  "test:tools",
];

/*
 * The links that call cargo, directly or through other npm scripts. This is a list on
 * purpose, not something worked out from the scripts at run time; run-check.test.mjs walks
 * the npm scripts of every link and fails when a link reaches cargo/rustc without being
 * listed here (or is listed without reaching it).
 *   check:format -> check:format:rust -> `cargo fmt --all -- --check`
 */
export const RUST_LINKS = ["check:format"];

/** The serial step before the parallel links. `rustup toolchain install` without a toolchain
 * argument takes the active toolchain, here the one rust-toolchain.toml names, with its
 * components ("Install or update ... by default the active toolchain"); rustup 1.28 points to
 * exactly this call to ensure installation, since `rustup show` only reports. With the
 * toolchain already present it only completes missing components. No retry. */
export const RUST_PRELUDE = {
  name: "prelude: rust toolchain",
  command: "rustup",
  args: ["toolchain", "install", "--no-self-update"],
};

const MAX_JOBS = 6;

/** The prelude steps for the selected links: [] unless one of them needs cargo. */
export function planPrelude(links) {
  return links.some((link) => RUST_LINKS.includes(link)) ? [RUST_PRELUDE] : [];
}

/**
 * Runs the prelude serially, then the links. `runStep(step)` resolves to
 * { code, output, missing? }; `missing` means the program is not installed. A missing rustup
 * is not an error: the cargo links then do what they did before the prelude existed (use
 * whatever cargo is on PATH, or fail with their own "command not found"). A red step stops
 * everything: the links would only fail on the same missing toolchain.
 */
export async function runCheck(links, { runLink, runStep, jobs }) {
  const prelude = [];
  for (const step of planPrelude(links)) {
    const started = Date.now();
    let outcome;
    try {
      outcome = await runStep(step);
    } catch (error) {
      outcome = { code: 1, output: `${error instanceof Error ? error.message : error}\n` };
    }
    prelude.push({ step, ...outcome, ms: Date.now() - started });
    if (outcome.code !== 0 && !outcome.missing) return { prelude, results: [], aborted: true };
  }
  return { prelude, results: await runLinks(links, runLink, jobs), aborted: false };
}

export function formatPrelude(prelude) {
  const lines = [];
  for (const { step, code, output, missing, ms } of prelude) {
    const status = missing ? "skipped (rustup not found)" : code === 0 ? "ok" : "FAILED";
    lines.push(`=== ${step.name} -- ${status} (${seconds(ms)}) ===`);
    if (code !== 0 && !missing) {
      if (output.trim() !== "") lines.push(output.replace(/\s+$/, ""));
      lines.push(
        `check: ${step.command} ${step.args.join(" ")} failed (exit ${code}); the toolchain from rust-toolchain.toml could not be installed, so no link was run`,
      );
    }
  }
  return lines.join("\n");
}

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

export function exitCode(results, prelude = []) {
  const red = prelude.some((step) => step.code !== 0 && !step.missing);
  return red || results.some((result) => result.code !== 0) ? 1 : 0;
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

function runPreludeStep(step) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) =>
      resolve({ code: 1, missing: error.code === "ENOENT", output: `${error.message}\n` }),
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") }),
    );
  });
}

async function main() {
  const started = Date.now();
  const { prelude, results, aborted } = await runCheck(LINKS, {
    runLink: runNpmScript,
    runStep: runPreludeStep,
    jobs: defaultJobs(),
  });
  if (prelude.length > 0) console.log(formatPrelude(prelude));
  if (!aborted) console.log(formatReport(results, Date.now() - started));
  process.exitCode = exitCode(results, prelude);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
