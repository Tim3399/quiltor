import { spawn, spawnSync } from "node:child_process";
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
 *
 * pyright evaluates `sys.platform` for the platform it runs on, so `ctypes.windll` is fine on
 * Windows and an error on Linux. Checking only the host's platform would let a Linux-only
 * error through a local `npm run check` and surface in CI, so every run checks Windows, Linux
 * and Darwin, in parallel, and is red when any of them is. A caller that passes
 * `--pythonplatform` itself gets exactly that one platform and nothing else.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const PLATFORMS = ["Windows", "Linux", "Darwin"];

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
const passthrough = process.argv.slice(2);

const pinsPlatform = passthrough.some(
  (arg) => arg === "--pythonplatform" || arg.startsWith("--pythonplatform="),
);

function check(platform, extra) {
  const args = [
    entry,
    "--pythonpath",
    python,
    ...(platform ? ["--pythonplatform", platform] : []),
    ...extra,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ platform, status: status ?? 1, output }));
  });
}

if (pinsPlatform) {
  const run = spawnSync(process.execPath, [entry, "--pythonpath", python, ...passthrough], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}

const results = await Promise.all(PLATFORMS.map((platform) => check(platform, passthrough)));
let failed = false;
for (const { platform, status, output } of results) {
  if (status === 0) {
    console.log(`pyright ${platform}: ok`);
    continue;
  }
  failed = true;
  console.log(`pyright ${platform}: FAILED`);
  process.stdout.write(output);
}
if (failed) {
  console.error(
    `pyright failed on: ${results
      .filter((r) => r.status !== 0)
      .map((r) => r.platform)
      .join(", ")}`,
  );
}
process.exit(failed ? 1 : 0);
