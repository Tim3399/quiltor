import { spawnSync } from "node:child_process";

/*
 * Runs a Python command with an interpreter that actually carries what the command needs.
 *
 * The npm scripts used to call a bare `python`, which is whatever stands first on PATH. On
 * one Windows machine that was Inkscape's bundled interpreter -- 3.12.12, so a version check
 * would have waved it through, and yet without ruff or the project installed. `npm run check`
 * then failed with "No module named ruff", which reads like a missing dependency rather than
 * the wrong Python.
 *
 * So the caller names the module it depends on, and the first candidate that can import it
 * wins. That is the true property in every case: the interpreter ruff was installed into is
 * the one that can run ruff.
 *
 * It also keeps CI working, where a bare `python` is the right answer: actions/setup-python
 * puts its interpreter first and pip installs into that one. The Windows launcher is tried
 * ahead of it and may well find some other 3.12 -- one without the module, which is exactly
 * why it gets skipped rather than chosen.
 */

const WINDOWS = process.platform === "win32";

// The pinned series first, then whatever the environment calls its Python.
const CANDIDATES = WINDOWS
  ? [
      ["py", ["-3.12"]],
      ["python", []],
      ["python3", []],
    ]
  : [
      ["python3.12", []],
      ["python3", []],
      ["python", []],
    ];

/*
 * No `shell` here, and that is the whole point.
 *
 * Through cmd, `-c "import ruff"` arrives split at the space: Python sees `-c import`, dies
 * of a syntax error, and every candidate looks like it lacks the module. doctor.mjs carries
 * the same warning about a `-c` snippet one file over -- the trap is easy to walk into twice.
 *
 * Nothing here needs a shell anyway: py, python and python3 are executables, not the .cmd
 * wrappers that force one. A candidate that does not exist comes back with a null status,
 * which counts as "cannot import" and moves on to the next.
 */
function canImport([command, prefix], module) {
  const run = spawnSync(command, [...prefix, "-c", `import ${module}`], { encoding: "utf8" });
  return run.status === 0;
}

const argv = process.argv.slice(2);
if (argv[0] !== "--needs" || argv.length < 3) {
  console.error("usage: node tools/dev/python.mjs --needs <module> <python arguments...>");
  process.exit(2);
}
const [, module, ...rest] = argv;

const chosen = CANDIDATES.find((candidate) => canImport(candidate, module));
if (!chosen) {
  const tried = CANDIDATES.map(([command, prefix]) => [command, ...prefix].join(" ")).join(", ");
  console.error(
    `No Python found that can import \`${module}\`. Tried: ${tried}.\n` +
      "`npm run doctor` shows which runtimes are here and how to get the ones that are not.",
  );
  process.exit(1);
}

const [command, prefix] = chosen;
const run = spawnSync(command, [...prefix, ...rest], { stdio: "inherit" });
process.exit(run.status ?? 1);
