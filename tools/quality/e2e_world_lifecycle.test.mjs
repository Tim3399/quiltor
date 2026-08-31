import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const e2eRoot = resolve(repositoryRoot, "tests/e2e");
const worldFixture = resolve(e2eRoot, "support/world-fixture.ts");
const applicationApiSupport = resolve(e2eRoot, "support/application-api.ts");

function specFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return specFiles(path);
    return entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

test("persistent E2E worlds are created only through the cleanup fixture", () => {
  for (const file of specFiles(e2eRoot)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /\/api\/worlds\/create/,
      `${relative(repositoryRoot, file)} bypasses the tracked world fixture`,
    );
  }

  const fixtureSource = readFileSync(worldFixture, "utf8");
  assert.match(fixtureSource, /\/api\/worlds\/create/);
  assert.match(fixtureSource, /\/api\/worlds\/delete/);
});

test("synthetic E2E worlds mock every document required to open a world", () => {
  const supportSource = readFileSync(applicationApiSupport, "utf8");
  assert.match(supportSource, /export function fulfillStoryboards/);
  assert.match(supportSource, /encodeStoryboardsV1/);
  for (const route of ["manuscript", "state", "storyboards"]) {
    assert.match(
      supportSource,
      new RegExp(`page\\.route\\("\\*\\*\\/api\\/${route}\\*"`),
      `tests/e2e/support/application-api.ts does not mock /api/${route}`,
    );
  }

  for (const file of specFiles(e2eRoot)) {
    const source = readFileSync(file, "utf8");
    if (!/\/api\/worlds\/open/.test(source)) continue;
    assert.match(
      source,
      /mockRequiredWorldDocuments/,
      `${relative(repositoryRoot, file)} mocks a synthetic world without all required documents`,
    );
  }
});
