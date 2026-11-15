import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, pythonCommand, ROOT, terminate, waitFor } from "./python-process";

/**
 * A Quiltor instance of its own with QUILTOR_TEST_HOOKS=1 and QUILTOR_CSP=enforce, serving
 * dist/ (T-61 part 8a, F-61-28). Only there does the client offer the cloud executor's test
 * profile and does connect-src name its origin. The suite's server on :8010 keeps running
 * without test hooks, so every other spec measures the policy that ships.
 */
export interface TestHooksServer {
  url: string;
  /** The tail of the server's own output, for a failure report. */
  output: () => string;
  stop: () => Promise<void>;
}

/**
 * `testHooks: false` starts the same instance without QUILTOR_TEST_HOOKS, so connect-src is
 * the policy that ships (D-T-61-7-E2E measures the in-browser engine against it).
 */
export async function startTestHooksServer(
  options: { testHooks?: boolean } = {},
): Promise<TestHooksServer> {
  const testHooks = options.testHooks ?? true;
  const [python, prefix] = pythonCommand();
  const scratch = mkdtempSync(join(tmpdir(), "quiltor-e2e-test-hooks-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const child: ChildProcess = spawn(
    python,
    [...prefix, "apps/web/server.py", String(port), "--no-open"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        QUILTOR_HOME: join(scratch, "quiltor"),
        ...(testHooks ? { QUILTOR_TEST_HOOKS: "1" } : {}),
        QUILTOR_CSP: "enforce",
        QUILTOR_CREDENTIAL_BACKEND: "memory",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk: Buffer) => logs.push(chunk.toString());
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const stop = async () => {
    await terminate(child);
    rmSync(scratch, { recursive: true, force: true });
  };
  const output = () => logs.join("").slice(-4000);
  try {
    await waitFor(`${url}/`, child, output);
    return { url, output, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
