import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lazyModules, viteFsUrl, warmUp } from "./warm-vite.mjs";

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
