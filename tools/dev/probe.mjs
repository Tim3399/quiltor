import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Measure something inside the running application without creating a file for it.
 *
 *   npm run probe -- "document.querySelectorAll('.story-node').length"
 *   npm run probe -- --places "[...document.querySelectorAll('.react-flow__node')].length"
 *   npm run probe -- --storyboard --wide "getComputedStyle(document.body).fontSize"
 *
 * The expression runs inside the page and its value comes back as JSON. The world is
 * prepared: figures, a place, an opened-out map with a place on it, a storyboard with a
 * group, two cards and one connection.
 *
 * Going through Playwright is deliberate. The embedded browser pane does not paint while it
 * is hidden; no ResizeObserver fires there, React Flow measures nothing, and the minimap
 * comes back empty. That looks like a finding and is not one -- I fell for it once.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The values are the German workspace buttons in the interface, so they stay as they are.
const WORKSPACES = {
  "--text": "Text",
  "--figures": "Figuren",
  "--timeline": "Timeline",
  "--places": "Orte",
  "--storyboard": "Storyboard",
};
const VIEWPORTS = { "--wide": "wide", "--regular": "regular", "--compact": "compact" };

const args = process.argv.slice(2);
let workspace = "";
let project = "wide";
let wait = "2000";
const rest = [];

for (let at = 0; at < args.length; at += 1) {
  const word = args[at];
  if (WORKSPACES[word]) workspace = WORKSPACES[word];
  else if (VIEWPORTS[word]) project = VIEWPORTS[word];
  else if (word === "--wait") wait = args[(at += 1)];
  else rest.push(word);
}

const expression = rest.join(" ").trim();
if (!expression) {
  console.error('Usage: npm run probe -- [--places] [--compact] "<javascript expression>"');
  console.error("The expression is evaluated in the page; its value comes back as JSON.");
  process.exit(2);
}

const run = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "tests/e2e/probe.spec.ts", `--project=${project}`, "--reporter=line"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      QUILTOR_PROBE: expression,
      QUILTOR_PROBE_WORKSPACE: workspace,
      QUILTOR_PROBE_WAIT: wait,
      PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    },
  },
);

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const reported = output.match(/^PROBE (.*)$/mu);

if (reported) {
  console.log(reported[1]);
  process.exit(0);
}

console.error("The probe reported nothing. Is `npm start` running?\n");
console.error(output.trim().split("\n").slice(-20).join("\n"));
process.exit(1);
