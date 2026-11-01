import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
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
 *
 * Every argument after -- reaches the command exactly as this script received it. No shell
 * sits in between: a shell would re-split and re-interpret the arguments, and on Windows
 * cmd.exe turned `bash -c "exit 1"` into `bash -c exit 1` -- a command that passes, so a
 * mutation that was never checked read as "does not bite". See runCommand below.
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

const run = runCommand(command[0], command.slice(1));
restore();

if (run.error) {
  // The command never ran, so it says nothing about the mutation either way.
  console.error(`Could not start ${command[0]}: ${run.error.message}`);
  process.exit(2);
}

console.log("");
if (run.status === 0) {
  console.log("The command passed even though the change was undone.");
  console.log("So the test does not check what it claims to check.");
  process.exitCode = 1;
} else {
  const how = run.status === null ? `signal ${run.signal}` : `code ${run.status}`;
  console.log(`The command failed (${how}) -- the test bites.`);
  process.exitCode = 0;
}

/*
 * Runs the command without a shell, so its arguments arrive unchanged.
 *
 * On Linux and macOS that is all there is to it. On Windows two things need doing by hand,
 * because a shell used to do them:
 *
 * - Finding the program. Node looks for the bare name and for .com/.exe only, so `npm`
 *   and `npx` -- which are npm.cmd and npx.cmd -- would not be found. The PATH is searched
 *   here with PATHEXT, in the PATH's own order, the way the calling shell would.
 * - Running a .cmd or .bat. Windows can only start a batch file through cmd.exe, and Node
 *   refuses to do it with shell: false. Here cmd.exe gets one command line in which every
 *   argument is quoted by the rules programs use to split their command line, and every
 *   cmd metacharacter -- the quotes included -- is escaped with a caret, so cmd never sees
 *   an open quote, a & or a %VAR%. The carets are doubled, because npm.cmd, npx.cmd and the
 *   node_modules/.bin shims hand %* on to the next program, and cmd parses that line a
 *   second time. This is the scheme cross-spawn uses for the same shims.
 *
 * Any other program is started directly, and Node quotes its arguments itself.
 */
function runCommand(program, programArgs) {
  const options = { cwd: ROOT, stdio: "inherit" };
  if (process.platform !== "win32") return spawnSync(program, programArgs, options);

  const found = findOnWindows(program);
  if (!found || !/^\.(cmd|bat)$/i.test(extname(found)))
    return spawnSync(found ?? program, programArgs, options);

  const line = [escapeCmdMeta(found), ...programArgs.map(quoteForBatch)].join(" ");
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

function findOnWindows(program) {
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = (base) => (extname(base) ? [base] : extensions.map((ext) => base + ext));
  const isFile = (path) => {
    try {
      return statSync(path).isFile();
    } catch (error) {
      // An app execution alias in WindowsApps (python.exe, py.exe) cannot be stat'ed, but
      // it can be started -- the calling shell would pick it, so this does too.
      return error.code === "EACCES";
    }
  };

  if (/[\\/]/.test(program)) {
    const base = isAbsolute(program) ? program : resolve(ROOT, program);
    return candidates(base).find(isFile);
  }
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const hit = candidates(join(dir.replace(/^"(.*)"$/, "$1"), program)).find(isFile);
    if (hit) return hit;
  }
  return undefined;
}

function escapeCmdMeta(text) {
  return text.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
}

function quoteForBatch(arg) {
  // Quote for the program's own argument splitting (CommandLineToArgvW): backslashes double
  // only where a quote follows them, and an embedded quote becomes \".
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  // Then escape for cmd twice: once for the cmd.exe line, once for the batch file's %*.
  return escapeCmdMeta(escapeCmdMeta(quoted));
}
