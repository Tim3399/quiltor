import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import warmGallery, {
  shouldWarm,
  WARM_TIMEOUT_MS,
} from "../../tests/design/warm-gallery.setup.mjs";
import { importAcrossReloads, lazyModules, viteFsUrl, warmUp } from "./warm-vite.mjs";

test("an import the page reloaded under runs again once it has loaded, a few times at most", async () => {
  const destroyed = new Error("page.evaluate: Execution context was destroyed");
  let tries = 0;
  let waits = 0;
  const flaky = async () => {
    tries += 1;
    if (tries < 3) throw destroyed;
    return "done";
  };
  assert.equal(await importAcrossReloads(flaky, async () => (waits += 1)), "done");
  assert.deepEqual([tries, waits], [3, 2]);

  await assert.rejects(
    importAcrossReloads(
      async () => {
        throw destroyed;
      },
      async () => {},
    ),
    /Execution context was destroyed/,
  );
  await assert.rejects(
    importAcrossReloads(
      async () => {
        throw new Error("404 Not Found");
      },
      async () => assert.fail("no reload to wait for"),
    ),
    /404/,
  );
});

test("the design config warms its own gallery before the first test, in CI", async () => {
  const config = readFileSync(
    new URL("../../playwright.design.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /globalSetup: "\.\/tests\/design\/warm-gallery\.setup\.mjs"/);

  const calls = [];
  const warm = async (options) => calls.push(options);
  const designConfig = { projects: [{ use: { baseURL: "http://127.0.0.1:4174" } }] };
  await warmGallery(designConfig, { warm, env: { CI: "true" } });
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:4174", timeoutMs: WARM_TIMEOUT_MS }]);

  await warmGallery(designConfig, { warm, env: {} });
  await warmGallery(designConfig, { warm, env: { CI: "true", QUILTOR_DESIGN_WARM: "0" } });
  assert.equal(calls.length, 1);
  assert.equal(shouldWarm({ CI: "1" }), true);
});

const never = () => new Promise(() => {});

test("warmUp opens the page, then imports every module in order", async () => {
  const calls = [];
  await warmUp({
    modules: ["a", "b"],
    timeoutMs: 1000,
    open: async () => calls.push("open"),
    importModule: async (module) => calls.push(module),
  });
  assert.deepEqual(calls, ["open", "a", "b"]);
});

test("warmUp fails when the page does not load within the time limit", async () => {
  await assert.rejects(
    warmUp({ modules: [], timeoutMs: 50, open: never, importModule: async () => {} }),
    /not warm within 50 ms/,
  );
});

test("warmUp fails when a module import hangs past the time limit", async () => {
  await assert.rejects(
    warmUp({ modules: ["slow"], timeoutMs: 50, open: async () => {}, importModule: never }),
    /not warm within 50 ms/,
  );
});

test("warmUp passes a failed import on instead of reporting success", async () => {
  await assert.rejects(
    warmUp({
      modules: ["broken"],
      timeoutMs: 1000,
      open: async () => {},
      importModule: async () => {
        throw new Error("500 broken");
      },
    }),
    /500 broken/,
  );
});

test("lazyModules finds relative dynamic imports and skips tests and package imports", () => {
  const root = mkdtempSync(join(tmpdir(), "warm-vite-"));
  try {
    mkdirSync(join(root, "feature"));
    writeFileSync(join(root, "feature", "Panel.tsx"), "export const Panel = 1;\n");
    writeFileSync(join(root, "feature", "index.ts"), 'const P = () => import("./Panel");\n');
    writeFileSync(join(root, "fonts.ts"), 'import("pagedjs"); import("@x/y.css");\n');
    writeFileSync(join(root, "a.test.ts"), 'import("./missing");\n');
    assert.deepEqual(lazyModules(root), [join(root, "feature", "Panel.tsx")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lazyModules refuses a dynamic import that does not resolve", () => {
  const root = mkdtempSync(join(tmpdir(), "warm-vite-"));
  try {
    writeFileSync(join(root, "index.ts"), 'import("./Gone");\n');
    assert.throws(() => lazyModules(root), /imports \.\/Gone, which does not resolve/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lazyModules finds the client workspaces", () => {
  const names = lazyModules().map((path) => path.replaceAll("\\", "/"));
  assert.ok(names.some((path) => path.endsWith("modules/manuscript/TextWorkspace.tsx")));
  assert.ok(names.some((path) => path.endsWith("story-world/places/PlacesWorkspace.tsx")));
});

test("viteFsUrl serves an absolute path under /@fs/", () => {
  const url = viteFsUrl(join(process.cwd(), "x.ts"));
  assert.match(url, /^\/@fs\/[^/]/);
  assert.ok(url.endsWith("/x.ts"));
});
