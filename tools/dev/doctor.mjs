import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * What the release preflight expects, and what is actually installed here.
 *
 * `release_preflight.py` demands exactly the runtimes from distribution/toolchains.json --
 * the same ones the release CI uses, so a version bump is never built with different tools
 * than the release itself. It reports only the first mismatch, then stops. Anyone with
 * three of them searches three times.
 *
 * This script shows all of them at once, with the install line next to each. It changes
 * nothing: installing a runtime touches the system, and that stays something a person
 * decides to do.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WINDOWS = process.platform === "win32";

const { releaseToolchains } = JSON.parse(
  readFileSync(resolve(ROOT, "distribution/toolchains.json"), "utf8"),
);

/** How to ask for the version, and how to install it. */
const RUNTIMES = [
  {
    name: "python",
    // The preflight checks the interpreter running it -- not whichever one is on PATH. So
    // the launcher is asked for this exact series rather than a bare "python".
    //
    // `--version` instead of a `-c` snippet: on Windows this call goes through cmd, and cmd
    // splits `import platform;print(...)` at the semicolon. Python received just `import`,
    // raised a syntax error, and this tool then claimed for hours that the interpreter did
    // not start -- for one that was there, only at a different patch level. An argument
    // without spaces or punctuation cannot suffer that.
    ask: WINDOWS ? ["py", ["-3.12", "--version"]] : ["python3.12", ["--version"]],
    clean: (text) => text.match(/Python\s+([0-9.]+)/u)?.[1] ?? text,
    hint: (expected) =>
      WINDOWS
        ? `winget install Python.Python.3.12 --version ${expected}`
        : `pyenv install ${expected}   (or the distribution's own package)`,
  },
  {
    name: "node",
    ask: ["node", ["--version"]],
    clean: (text) => text.replace(/^v/u, ""),
    // On Windows this used to name `nvm` alone, and sent somebody to a command that is not
    // there: a version manager is a separate install, and winget is no way out either --
    // its Node package carries no 22.x at all, the list starts at 24. nodejs.org keeps
    // every release, and the pinned installer brings the pinned npm with it, so one
    // download settles both lines. A manager, where there is one, still does it in place.
    hint: (expected) =>
      WINDOWS
        ? `https://nodejs.org/dist/v${expected}/node-v${expected}-${process.arch === "arm64" ? "arm64" : "x64"}.msi` +
          `   (or nvm install ${expected}, if one is installed)`
        : `nvm install ${expected}   (or volta pin node@${expected})`,
  },
  {
    name: "npm",
    ask: [WINDOWS ? "npm.cmd" : "npm", ["--version"]],
    hint: (expected) => `npm install --global npm@${expected}`,
  },
  {
    name: "rust",
    ask: ["cargo", ["--version"]],
    clean: (text) => text.match(/cargo\s+([0-9.]+)/u)?.[1] ?? text,
    hint: (expected) => `rustup toolchain install ${expected} && rustup default ${expected}`,
  },
];

function measure({ ask: [command, args], clean }) {
  const run = spawnSync(command, args, { encoding: "utf8", shell: WINDOWS });
  if (run.status !== 0) {
    const reason = run.error?.code === "ENOENT" ? "not found" : "does not start";
    return { missing: true, text: reason };
  }
  const raw = (run.stdout || run.stderr).trim().split("\n").pop().trim();
  return { missing: false, text: clean ? clean(raw) : raw };
}

const rows = [];
let mismatches = 0;

for (const runtime of RUNTIMES) {
  const expected = releaseToolchains[runtime.name];
  const found = measure(runtime);
  const matches = !found.missing && found.text === expected;
  if (!matches) mismatches += 1;
  rows.push({
    mark: matches ? "  ok " : "  -- ",
    name: runtime.name.padEnd(7),
    expected: expected.padEnd(9),
    found: found.text,
    hint: matches ? "" : runtime.hint(expected),
  });
}

console.log("Runtimes the release preflight expects (distribution/toolchains.json):\n");
for (const row of rows) {
  console.log(`${row.mark}${row.name} wants ${row.expected} has ${row.found}`);
  if (row.hint) console.log(`         ${row.hint}`);
}

console.log("");
if (mismatches === 0) {
  console.log("All four match. `npm run set-version` can run.");
} else {
  console.log(
    `${mismatches} of ${RUNTIMES.length} differ. While that holds, \`npm run set-version\` ` +
      "refuses the version change -- and rightly so: a release built locally with other " +
      "tools than CI uses cannot be retraced.",
  );
  console.log("Everyday work -- npm start, npm test, the check gates -- is untouched by it.");
}

process.exitCode = mismatches === 0 ? 0 : 1;
