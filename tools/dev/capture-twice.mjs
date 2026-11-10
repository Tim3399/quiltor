#!/usr/bin/env node
/*
 * Takes every newly generated baseline a second time and fails unless both are identical.
 *
 *   node tools/dev/capture-twice.mjs <snapshot-dir> -- <command that generates them> ...
 *
 * "New" means untracked by git in <snapshot-dir>. Those files are set aside, the command runs
 * again and writes them anew, and each pair is compared byte for byte. A baseline that comes
 * out differently from one page load to the next would make every later comparison a coin
 * toss, so it must never be checked in (T-231). The command's own exit status is not the
 * verdict -- a bootstrap pass reports missing images as failures by design -- but an image it
 * does not write again is.
 *
 * The command runs without a shell, so its arguments arrive as given.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

function usage(message) {
  console.error(`capture-twice: ${message}`);
  console.error("usage: node tools/dev/capture-twice.mjs <snapshot-dir> -- <command> [args...]");
  process.exit(2);
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");
if (separator !== 1) usage("expected exactly one snapshot directory before --");
const dir = args[0];
const command = args.slice(separator + 1);
if (command.length === 0) usage("no command after --");

const listed = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", dir], {
  encoding: "utf8",
});
if (listed.status !== 0) usage(`git ls-files failed: ${listed.stderr.trim()}`);
const fresh = listed.stdout.split("\0").filter((file) => file.endsWith(".png"));
if (fresh.length === 0) {
  console.log("capture-twice: no new baselines, nothing to take twice.");
  process.exit(0);
}

const firstTake = mkdtempSync(join(tmpdir(), "capture-twice-"));
for (const file of fresh) {
  copyFileSync(file, join(firstTake, basename(file)));
  rmSync(file);
}
console.log(`capture-twice: taking ${fresh.length} new baseline(s) a second time.`);
const second = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
if (second.error) usage(`could not start ${command[0]}: ${second.error.message}`);

const differing = [];
for (const file of fresh) {
  const first = readFileSync(join(firstTake, basename(file)));
  if (!existsSync(file)) {
    // Put the first take back so the run's diagnostics still show it.
    copyFileSync(join(firstTake, basename(file)), file);
    differing.push(`${file}: not written by the second take`);
  } else if (!first.equals(readFileSync(file))) {
    copyFileSync(join(firstTake, basename(file)), `${file}.first-take.png`);
    differing.push(
      `${file}: differs from the first take (kept as ${basename(file)}.first-take.png)`,
    );
  }
}
rmSync(firstTake, { recursive: true, force: true });

if (differing.length > 0) {
  for (const line of differing) console.error(`::error::${line}`);
  console.error(
    `capture-twice: ${differing.length} of ${fresh.length} new baseline(s) are not reproducible.`,
  );
  process.exit(1);
}
console.log(`capture-twice: all ${fresh.length} new baseline(s) came out identical twice.`);
