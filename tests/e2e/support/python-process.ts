import { type ChildProcess, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

/**
 * What a spec needs to run Python processes of its own beside the suite's server on :8010:
 * the interpreter, a free loopback port, waiting until a process answers, and stopping it.
 * Shared by the real sync endpoint (T-164) and the test-hooks server (T-61 part 8a).
 */

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * `PLAYWRIGHT_PYTHON` when set; otherwise the pinned 3.12 through the Windows launcher, else
 * `python3` and `python`. In CI that is the interpreter pip installed the application into,
 * which is the one that can import it.
 */
export function pythonCommand(): [string, string[]] {
  const candidates: Array<[string, string[]]> = process.env.PLAYWRIGHT_PYTHON
    ? [[process.env.PLAYWRIGHT_PYTHON, []]]
    : process.platform === "win32"
      ? [
          ["py", ["-3.12"]],
          ["python", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];
  for (const [command, prefix] of candidates) {
    if (spawnSync(command, [...prefix, "-c", "import sys"]).status === 0) return [command, prefix];
  }
  throw new Error("No Python found for a spec's own server; set PLAYWRIGHT_PYTHON.");
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export async function waitFor(url: string, process_: ChildProcess, output: () => string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (process_.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up.\n${output()}`);
}

export async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  // The Windows launcher starts the interpreter as a child, so kill the whole tree there.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}
