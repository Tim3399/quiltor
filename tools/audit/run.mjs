// Entry point of `npm run audit:layout` and `npm run audit:layout:ai`.
//
//   node tools/audit/run.mjs [--ai] [auditDir]
//
// 1. checks that the application answers (the capture projects talk to the built dist/ the
//    Python server serves), 2. runs the Playwright capture projects, 3. optionally runs the AI
//    review, 4. writes the report. Findings never change the exit code; a failed step does.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUDIT_DIR } from "./manifest.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8010";

const args = process.argv.slice(2);
const withAi = args.includes("--ai");
const auditDir = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_AUDIT_DIR;

function fail(message) {
  console.error(`Layout audit failed: ${message}`);
  process.exit(1);
}

async function serverAnswers() {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Runs a node script with inherited output and stops the audit when it fails. */
function runNode(label, scriptArgs) {
  console.log(`\n== ${label}`);
  const result = spawnSync(process.execPath, scriptArgs, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with status ${result.status ?? result.signal}`);
}

if (!(await serverAnswers())) {
  fail(
    `nothing answers at ${baseURL}. The audit captures the built application: ` +
      "run `npm run build`, start the server with `py -3.12 apps/web/server.py 8010 --no-open`, " +
      "then run the audit again.",
  );
}

// Playwright's own CLI, started through node so no shell or bare `npx` is involved.
const playwrightCli = require.resolve("@playwright/test/cli");
runNode("Capture and rule checks", [
  playwrightCli,
  "test",
  "--config",
  "playwright.audit.config.ts",
  "--project",
  "capture-*",
]);
if (withAi) runNode("AI review", ["tools/audit/ai-review.mjs", auditDir]);
runNode("Report", ["tools/audit/report.mjs", auditDir]);
console.log(`\nLayout audit finished. Open ${auditDir}/index.html`);
