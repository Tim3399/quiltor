import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The counter-check for a test: undo the fix and see whether the test notices.
 *
 * A test that is green after a fix proves nothing -- it might have been green before
 * anything was right. That has already happened in this tree: a geometry test passed while
 * the bug was back in, because the column it measured was not on screen at all.
 *
 *   node tools/dev/mutate.mjs <file> --from "<text>" --to "<text>" -- <command ...>
 *
 * Success here means the command fails. The file is restored afterwards, even if the
 * command crashes or somebody interrupts.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fail(text) {
  console.error(text);
  process.exit(2);
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");
if (separator < 0) fail("The -- before the command is missing.");

const [file, ...rest] = args.slice(0, separator);
const command = args.slice(separator + 1);
if (!file || !command.length) fail("Usage: mutate.mjs <file> --from X --to Y -- <command>");

const optionValue = (name) => {
  const at = rest.indexOf(name);
  return at < 0 ? undefined : rest[at + 1];
};
const from = optionValue("--from");
const to = optionValue("--to") ?? "";
if (from === undefined)
  fail("--from is missing: without the text to replace there is nothing to do.");

const path = resolve(ROOT, file);
const original = readFileSync(path, "utf8");
if (!original.includes(from)) fail(`Not found in ${file}: ${from.slice(0, 60)}`);

const occurrences = original.split(from).length - 1;
console.log(`${file}: ${occurrences}× "${from.slice(0, 50)}" -> "${to.slice(0, 50)}"`);

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  writeFileSync(path, original);
  console.log(`${file} restored.`);
}
process.on("exit", restore);
process.on("SIGINT", () => process.exit(130));

writeFileSync(path, original.split(from).join(to));

const run = spawnSync(command[0], command.slice(1), {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
restore();

console.log("");
if (run.status === 0) {
  console.log("The command passed even though the change was undone.");
  console.log("So the test does not check what it claims to check.");
  process.exitCode = 1;
} else {
  console.log(`The command failed (code ${run.status}) -- the test bites.`);
  process.exitCode = 0;
}
