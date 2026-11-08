import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findDeadKeys, readSearchedCode } from "./locale_dead_keys.mjs";

test("a key used through t() is not dead", () => {
  assert.deepEqual(findDeadKeys(["openWorld"], 'label={t("openWorld")}'), []);
});

test("a key named in a lookup table is not dead", () => {
  const code = 'const items = [{ labelKey: "storyboardTitle" }]; const x = messages.exportBook;';
  assert.deepEqual(findDeadKeys(["storyboardTitle", "exportBook"], code), []);
});

test("a key that no code mentions is reported, in catalog order", () => {
  assert.deepEqual(findDeadKeys(["alpha", "openWorld", "zeta"], 't("openWorld")'), [
    "alpha",
    "zeta",
  ]);
});

test("a longer identifier does not keep a shorter key alive", () => {
  assert.deepEqual(findDeadKeys(["export"], 't("exportBook")'), ["export"]);
  assert.deepEqual(findDeadKeys(["exportBook"], 't("export")'), ["exportBook"]);
});

/** A throw-away repository with the given files, each path relative to its root. */
function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "locale-dead-keys-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("a key that only a test or a tool names is dead", () => {
  const root = repository({
    "packages/client/src/App.tsx": 't("openWorld")',
    "apps/web/server.py": 'messages["pythonProduct"]',
    "packages/client/src/App.test.tsx": "expect(messages.cloudTitle)",
    "packages/client/src/cloud.spec.ts": 't("cloudSpecOnly")',
    "src/quiltor/tests/test_texts.py": 'messages["pythonTestOnly"]',
    "tests/e2e/flow.spec.ts": 't("e2eOnly")',
    "tools/quality/check.mjs": 't("toolOnly")',
  });
  try {
    const code = readSearchedCode(root);
    const keys = [
      "openWorld",
      "cloudTitle",
      "cloudSpecOnly",
      "pythonTestOnly",
      "e2eOnly",
      "toolOnly",
    ];
    assert.deepEqual(findDeadKeys(keys, code), [
      "cloudTitle",
      "cloudSpecOnly",
      "pythonTestOnly",
      "e2eOnly",
      "toolOnly",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
