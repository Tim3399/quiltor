import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Runs the npm-pinned pyright against an interpreter that carries the project's dependencies.
 *
 * pyright resolves third-party imports through a Python interpreter. Left alone it picks a
 * bare `python` from PATH, which CLAUDE.md warns may be one without them. python.mjs already
 * knows how to choose the right one (`--needs typer`), so this script asks it for that
 * interpreter's sys.executable instead of repeating the choice, and hands the path to pyright.
 *
 * pyright is found through package resolution rather than a fixed node_modules path. That is
 * also what lets knip see the dependency being used.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

const manifestPath = require.resolve("pyright/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = join(dirname(manifestPath), manifest.bin.pyright);

const probe = spawnSync(
  process.execPath,
  [
    join(ROOT, "tools", "dev", "python.mjs"),
    "--needs",
    "typer",
    "-c",
    "import sys; print(sys.executable)",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
if (probe.status !== 0) {
  process.exit(probe.status ?? 1);
}
const python = probe.stdout.trim();

const run = spawnSync(process.execPath, [entry, "--pythonpath", python, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
