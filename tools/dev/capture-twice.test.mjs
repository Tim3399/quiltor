import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * capture-twice.mjs end to end in a scratch repository: a tracked baseline is left alone, an
 * untracked one is taken again by a generator, and the verdict depends on whether the
 * generator writes the same bytes twice.
 */

const TOOL = fileURLToPath(new URL("./capture-twice.mjs", import.meta.url));

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "capture-twice-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  mkdirSync(join(root, "snaps"));
  writeFileSync(join(root, "snaps", "old.png"), "old");
  git("add", "snaps/old.png");
  // Writes snaps/new.png: the same bytes every time, or new ones when UNSTABLE is set.
  const generator = join(root, "generate.mjs");
  writeFileSync(
    generator,
    "import { writeFileSync } from 'node:fs';\n" +
      "const unstable = process.env.UNSTABLE === '1';\n" +
      "if (process.env.SKIP !== '1')\n" +
      "  writeFileSync('snaps/new.png', unstable ? String(Math.random()) : 'stable');\n" +
      "process.exit(1);\n",
  );
  const run = (env = {}) =>
    spawnSync(process.execPath, [TOOL, "snaps", "--", process.execPath, generator], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  return { root, generator, run };
}

test("nothing new: nothing is taken again", (t) => {
  const { run } = repository(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no new baselines/);
});

test("a new baseline that comes out the same twice passes, though the generator exits 1", (t) => {
  const { root, run } = repository(t);
  writeFileSync(join(root, "snaps", "new.png"), "stable");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all 1 new baseline\(s\) came out identical twice/);
});

test("a new baseline that differs on the second take fails and keeps both", (t) => {
  const { root, run } = repository(t);
  writeFileSync(join(root, "snaps", "new.png"), "first");
  const result = run({ UNSTABLE: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /snaps\/new\.png: differs from the first take/);
  assert.ok(existsSync(join(root, "snaps", "new.png.first-take.png")));
});

test("a new baseline the second take does not write fails", (t) => {
  const { root, run } = repository(t);
  writeFileSync(join(root, "snaps", "new.png"), "stable");
  const result = run({ SKIP: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not written by the second take/);
  assert.ok(existsSync(join(root, "snaps", "new.png")), "the first take is put back");
});

test("a tracked baseline is never taken again", (t) => {
  const { root, run } = repository(t);
  writeFileSync(join(root, "snaps", "old.png"), "changed");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no new baselines/);
});
