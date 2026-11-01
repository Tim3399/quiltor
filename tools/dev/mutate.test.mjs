import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * mutate.mjs end to end: a scratch file is mutated, a command runs, the verdict comes back.
 * The point under test is that the command after -- receives its arguments unchanged --
 * a shell in between once turned `bash -c "exit 1"` into a command that passed.
 */

const MUTATE = fileURLToPath(new URL("./mutate.mjs", import.meta.url));
const WINDOWS = process.platform === "win32";

// The arguments a shell would mangle: spaces, quotes, backslashes before a quote and at the
// end, cmd metacharacters, a variable reference, an empty argument.
const AWKWARD = [
  "a b",
  'say "hi"',
  'back\\"slash',
  "trailing\\",
  "C:\\dir with space\\",
  "x&y|z<w>v",
  "^caret (paren) !bang! `tick` ;semi, comma",
  "%OS%",
  "$HOME",
  "",
];

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "mutate-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "target.txt");
  writeFileSync(target, "before\n");
  const argv = join(dir, "argv.mjs");
  // Prints the arguments it received as one JSON line, then exits with $EXIT_CODE.
  writeFileSync(
    argv,
    "console.log('ARGV ' + JSON.stringify(process.argv.slice(2)));\n" +
      "process.exit(Number(process.env.EXIT_CODE ?? 0));\n",
  );
  return { dir, target, argv };
}

function mutate(target, command, env = {}) {
  const run = spawnSync(
    process.execPath,
    [MUTATE, target, "--from", "before", "--to", "after", "--", ...command],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith("ARGV "));
  return { ...run, received: line ? JSON.parse(line.slice(5)) : undefined };
}

test("arguments reach a program unchanged", (t) => {
  const { target, argv } = scratch(t);
  const run = mutate(target, ["node", argv, ...AWKWARD]);
  assert.deepEqual(run.received, AWKWARD, run.stdout + run.stderr);
  assert.equal(readFileSync(target, "utf8"), "before\n", "the file must be restored");
});

test("a command that exits 1 makes the test bite", (t) => {
  const { target, argv } = scratch(t);
  const run = mutate(target, ["node", argv], { EXIT_CODE: "1" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /The command failed \(code 1\) -- the test bites\./);
});

test("a command that exits 0 means the test does not bite", (t) => {
  const { target, argv } = scratch(t);
  const run = mutate(target, ["node", argv]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /The command passed even though the change was undone\./);
});

test("a command that cannot start is an error, not a bite", (t) => {
  const { target } = scratch(t);
  const run = mutate(target, ["no-such-program-for-mutate-test"]);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stderr, /Could not start no-such-program-for-mutate-test/);
  assert.equal(readFileSync(target, "utf8"), "before\n", "the file must be restored");
});

test("an npm script runs, with its arguments and its exit code", (t) => {
  const { dir, target } = scratch(t);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "mutate-probe", private: true, scripts: { probe: `node argv.mjs` } }),
  );
  const ok = mutate(target, ["npm", "--prefix", dir, "run", "--silent", "probe", "--", "a b"]);
  assert.deepEqual(ok.received, ["a b"], ok.stdout + ok.stderr);
  assert.equal(ok.status, 1, "a passing npm script means the test does not bite");

  const failing = mutate(target, ["npm", "--prefix", dir, "run", "--silent", "probe"], {
    EXIT_CODE: "1",
  });
  assert.equal(failing.status, 0, failing.stdout + failing.stderr);
  assert.match(failing.stdout, /the test bites/);
});

test("a batch file forwarding %* receives its arguments unchanged", {
  skip: !WINDOWS && "batch files exist only on Windows",
}, (t) => {
  const { dir, target } = scratch(t);
  // Shaped like npm.cmd and the node_modules/.bin shims: hand everything on with %*.
  const shim = join(dir, "probe shim.cmd");
  writeFileSync(shim, `@"${process.execPath}" "%~dp0argv.mjs" %*\r\n`);
  const run = mutate(target, [shim, ...AWKWARD]);
  assert.deepEqual(run.received, AWKWARD, run.stdout + run.stderr);
});

function gitBash() {
  // Git for Windows' bash, found next to git itself -- not whatever `bash` the PATH
  // offers first, which from PowerShell is WSL's System32\bash.exe.
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (!existsSync(join(dir, "git.exe"))) continue;
    const bash = join(dirname(dir), "bin", "bash.exe");
    if (existsSync(bash)) return bash;
  }
  return undefined;
}

const BASH = WINDOWS ? gitBash() : undefined;

test('bash -c "exit 1" bites and bash -c "exit 0" does not', {
  skip:
    (!WINDOWS && "the cmd.exe quoting this guards against exists only on Windows") ||
    (!BASH && "Git Bash was not found next to git.exe"),
}, (t) => {
  const { target } = scratch(t);
  const failing = mutate(target, [BASH, "-c", "exit 1"]);
  assert.equal(failing.status, 0, failing.stdout + failing.stderr);
  assert.match(failing.stdout, /The command failed \(code 1\)/);

  const passing = mutate(target, [BASH, "-c", "exit 0"]);
  assert.equal(passing.status, 1, passing.stdout + passing.stderr);
});
