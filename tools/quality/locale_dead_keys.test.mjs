import assert from "node:assert/strict";
import { test } from "node:test";
import { findDeadKeys } from "./locale_dead_keys.mjs";

test("a key used through t() is not dead", () => {
  assert.deepEqual(findDeadKeys(["openWorld"], 'label={t("openWorld")}'), []);
});

test("a key named in a lookup table or a test is not dead", () => {
  const code = 'const items = [{ labelKey: "storyboardTitle" }]; expect(messages.exportBook)';
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
