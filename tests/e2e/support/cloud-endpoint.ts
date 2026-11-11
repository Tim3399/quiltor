import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A real sync setup for the product suite, with nothing on the wire stubbed (T-164, D-87).
 *
 * Three processes on free loopback ports, each with its own scratch directory:
 *
 * - the token issuer (`cloud_issuer.py`, the repository's FakeIssuer) that a sign-in goes
 *   through and that the backup server asks about every token,
 * - the reference backup server (`services/backup-server/server.py`) -- the very file that
 *   ships, not a fake -- as the sync endpoint,
 * - a second Quiltor instance, with no target configured, so a person sets one up and signs in.
 *
 * The suite's shared server on :8010 stays untouched: it has no token for any endpoint, and
 * a run that changes its environment would change every other spec with it.
 *
 * Python comes from `PLAYWRIGHT_PYTHON` when set; otherwise the pinned 3.12 through the
 * Windows launcher, else `python3` and `python`. In CI that is the interpreter pip installed
 * the application into, which is the one that can import it.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface CloudEndpoint {
  /** Where the browser talks to: the second Quiltor instance. */
  quiltorUrl: string;
  /** The address a person types into the sync tab: the backup server. */
  endpointUrl: string;
  stop: () => Promise<void>;
}

function pythonCommand(): [string, string[]] {
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
  throw new Error("No Python found for the real sync endpoint; set PLAYWRIGHT_PYTHON.");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, process_: ChildProcess, output: () => string) {
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

async function terminate(child: ChildProcess) {
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

export async function startCloudEndpoint(): Promise<CloudEndpoint> {
  const [python, prefix] = pythonCommand();
  const scratch = mkdtempSync(join(tmpdir(), "quiltor-e2e-cloud-"));
  const [issuerPort, endpointPort, quiltorPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const issuerUrl = `http://127.0.0.1:${issuerPort}`;
  const endpointUrl = `http://127.0.0.1:${endpointPort}`;
  const children: ChildProcess[] = [];
  const logs: string[] = [];
  const launch = (name: string, args: string[], environment: Record<string, string>) => {
    const child = spawn(python, [...prefix, ...args], {
      cwd: ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => logs.push(`[${name}] ${chunk.toString()}`);
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    children.push(child);
    return child;
  };
  const stop = async () => {
    await Promise.all(children.map(terminate));
    rmSync(scratch, { recursive: true, force: true });
  };
  const output = () => logs.join("").slice(-4000);

  try {
    const issuer = launch("issuer", ["tests/e2e/support/cloud_issuer.py", String(issuerPort)], {
      PYTHONPATH: ROOT,
    });
    await waitFor(`${issuerUrl}/.well-known/openid-configuration`, issuer, output);

    const endpoint = launch(
      "endpoint",
      ["services/backup-server/server.py", "--host", "127.0.0.1", "--port", String(endpointPort)],
      {
        QUILTOR_BACKUP_ROOT: join(scratch, "endpoint"),
        QUILTOR_BACKUP_OIDC_ISSUER: issuerUrl,
        QUILTOR_BACKUP_OIDC_CLIENT_ID: "quiltor-backup",
        QUILTOR_BACKUP_OIDC_CLIENT_SECRET: "e2e-secret",
        QUILTOR_BACKUP_PUBLIC_URL: endpointUrl,
        QUILTOR_BACKUP_OIDC_ALLOW_INSECURE_LOOPBACK: "1",
      },
    );
    await waitFor(`${endpointUrl}/.well-known/oauth-protected-resource`, endpoint, output);

    const quiltor = launch("quiltor", ["apps/web/server.py", String(quiltorPort), "--no-open"], {
      QUILTOR_HOME: join(scratch, "quiltor"),
      // The sign-in must not reach the machine's real credential store.
      QUILTOR_CREDENTIAL_BACKEND: "memory",
      QUILTOR_BACKUP_OIDC_ALLOW_INSECURE_LOOPBACK: "1",
    });
    const quiltorUrl = `http://127.0.0.1:${quiltorPort}`;
    await waitFor(`${quiltorUrl}/`, quiltor, output);
    return { quiltorUrl, endpointUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
