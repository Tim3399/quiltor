import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_DESIGN_PORT, resolveDesignPort } from "./design-port.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("design port defaults to 4174 and follows QUILTOR_DESIGN_PORT", () => {
  assert.equal(DEFAULT_DESIGN_PORT, 4174);
  assert.equal(resolveDesignPort({}), 4174);
  assert.equal(resolveDesignPort({ QUILTOR_DESIGN_PORT: "" }), 4174);
  assert.equal(resolveDesignPort({ QUILTOR_DESIGN_PORT: "4184" }), 4184);
});

test("design port rejects values that are not a usable port", () => {
  for (const raw of ["abc", "41.5", "80", "70000", "-1", " 4184"]) {
    assert.throws(() => resolveDesignPort({ QUILTOR_DESIGN_PORT: raw }), /QUILTOR_DESIGN_PORT/);
  }
});

test("design suite refuses a foreign server on its port instead of testing it", async () => {
  // Stands in for another worktree's gallery. Reusing it would run the suite against foreign
  // sources; the run has to stop with Playwright's port error before any test starts.
  let hits = 0;
  const foreign = createServer((_req, res) => {
    hits += 1;
    res.end("foreign gallery");
  });
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  const { port } = foreign.address();
  try {
    const run = await new Promise((resolve) => {
      // Async spawn, so the foreign server keeps answering while Playwright probes it.
      const child = spawn(
        process.execPath,
        [
          "node_modules/@playwright/test/cli.js",
          "test",
          "--config",
          "playwright.design.config.ts",
          "--reporter=line",
          "--max-failures=1",
          "--project=design-desktop",
        ],
        {
          cwd: root,
          env: { ...process.env, CI: "", QUILTOR_DESIGN_PORT: String(port) },
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      // With reuse back in, the suite would run against the foreign server; stop it early.
      const timer = setTimeout(() => {
        output += "\n[test] still running after 60s, the suite reused the foreign server\n";
        child.kill();
      }, 60_000);
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve({ status, output });
      });
    });
    assert.notEqual(run.status, 0, run.output);
    assert.match(run.output, new RegExp(`127\\.0\\.0\\.1:${port} is already used`), run.output);
    assert.doesNotMatch(run.output, /\d+ (passed|failed)/, run.output);
    assert.ok(hits > 0, "Playwright never probed the port");
  } finally {
    foreign.close();
  }
});
