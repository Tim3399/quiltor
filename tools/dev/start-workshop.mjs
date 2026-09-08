import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Start the workshop locally -- both halves, in one command.
 *
 * Vite alone is not enough: it serves the client and forwards /api to the Python server on
 * 8000. Without that server the page loads and says "Quiltor ist vorübergehend nicht
 * erreichbar" -- which looks like a fault in the application and is none. That is what this
 * script is for: whoever starts it gets both halves, or an explanation why not.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_PORT = Number(process.env.QUILTOR_DEV_PORT ?? 5173);
const API_PORT = Number(process.env.QUILTOR_API_PORT ?? 8000);
const WINDOWS = process.platform === "win32";

/**
 * A Python that actually starts.
 *
 * Not merely one the launcher lists: a release run can register its Python from a temp
 * directory as the system version, and once that directory is cleaned up an entry stays
 * behind that dies when called. So every candidate is run once instead of believed.
 */
function findPython() {
  // 3.12 first: that is the series everything is built, checked and shipped with. Newer ones
  // work too -- anyone with 3.13 or 3.14 installed should be able to use it -- but the
  // series in which a failure also shows up in CI comes first.
  const candidates = WINDOWS
    ? [
        ["py", ["-3.12"]],
        ["py", ["-3.13"]],
        ["py", ["-3.14"]],
        ["python", []],
      ]
    : [
        ["python3.12", []],
        ["python3.13", []],
        ["python3.14", []],
        ["python3", []],
      ];

  const rejected = [];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(
      command,
      [...prefix, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) return [command, prefix];
    const reason =
      probe.error?.code === "ENOENT"
        ? "not present"
        : probe.status === 1
          ? "older than 3.12"
          : (probe.stderr || "").split("\n")[0] || "does not start";
    rejected.push(`  ${[command, ...prefix].join(" ")}: ${reason}`);
  }

  console.error("No usable Python found. The project needs 3.12 or newer.");
  console.error(rejected.join("\n"));
  process.exit(1);
}

function start(name, command, args, environment) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    shell: WINDOWS,
  });
  const show = (data) => {
    for (const line of String(data).split("\n")) {
      if (line.trim()) console.log(`[${name}] ${line.trimEnd()}`);
    }
  };
  child.stdout.on("data", show);
  child.stderr.on("data", show);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`\n[${name}] exited with code ${code}. Stopping everything.`);
      shutDown(1);
    }
  });
  return child;
}

async function waitFor(url, name, seconds = 60) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (answer.ok) return true;
    } catch {
      // Not there yet; try again in a moment.
    }
    await new Promise((next) => setTimeout(next, 1000));
  }
  console.error(`${name} did not answer on ${url} within ${seconds}s.`);
  return false;
}

const children = [];
let stopping = false;

function shutDown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // Vite and the server start processes of their own; on Windows the whole tree has to go,
    // or the port stays taken and the next start fails on --strictPort.
    if (WINDOWS)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutDown(0));
process.on("SIGTERM", () => shutDown(0));

const server = resolve(ROOT, "apps/web/server.py");
if (!existsSync(server)) {
  console.error(`Not found: ${server}. Is the script running in the right directory?`);
  process.exit(1);
}

const [python, prefix] = findPython();
console.log(`Python: ${[python, ...prefix].join(" ")}`);

children.push(
  start(
    "api",
    python,
    [...prefix, "apps/web/server.py", String(API_PORT), "--no-open"],
    // Without src on the path the server cannot find the package unless it is installed.
    { PYTHONPATH: "src", PYTHONIOENCODING: "utf-8" },
  ),
);

if (!(await waitFor(`http://127.0.0.1:${API_PORT}/api/version`, "The API server"))) {
  shutDown(1);
}
console.log(`API ready on http://127.0.0.1:${API_PORT}`);

children.push(
  start("web", WINDOWS ? "npx.cmd" : "npx", [
    "vite",
    "--port",
    String(CLIENT_PORT),
    "--strictPort",
    "--host",
    "127.0.0.1",
  ]),
);

if (!(await waitFor(`http://127.0.0.1:${CLIENT_PORT}/`, "Vite"))) shutDown(1);

console.log("");
console.log(`  The workshop is running: http://127.0.0.1:${CLIENT_PORT}`);
console.log("  Stop with Ctrl+C.");
console.log("");
