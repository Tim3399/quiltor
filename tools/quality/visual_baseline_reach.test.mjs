import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  checkVisualBaselineReach,
  pinnedPlatform,
  suitePlatforms,
} from "./visual_baseline_reach.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-baseline-reach-"));

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function world(name, { runner, runsSuite, pinned = "darwin", images = ["a-darwin.png"] }) {
  const root = resolve(fixtureRoot, name);
  mkdirSync(resolve(root, ".github/workflows"), { recursive: true });
  mkdirSync(resolve(root, "tests/e2e/visual-baseline.spec.ts-snapshots"), { recursive: true });
  writeFileSync(
    resolve(root, "tests/e2e/visual-baseline.spec.ts"),
    `test.skip(process.platform !== "${pinned}", "gebunden");\n`,
    "utf8",
  );
  for (const image of images) {
    writeFileSync(resolve(root, "tests/e2e/visual-baseline.spec.ts-snapshots", image), "", "utf8");
  }
  writeFileSync(
    resolve(root, ".github/workflows/test.yml"),
    [
      "jobs:",
      "  unit:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - run: npm test",
      "  browser:",
      `    runs-on: ${runner}`,
      "    steps:",
      `      - run: ${runsSuite ? "npx playwright test" : "npm run build"}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

test("liest die gebundene Plattform aus dem Skip-Guard", () => {
  assert.equal(pinnedPlatform('test.skip(process.platform !== "darwin", "x");'), "darwin");
  assert.equal(pinnedPlatform("test.skip(true);"), undefined);
});

test("zaehlt nur Jobs, die die Suite auch ausfuehren", () => {
  const workflow = [
    "jobs:",
    "  package:",
    "    runs-on: macos-15",
    "    steps:",
    "      - run: npm run build",
    "  browser:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - run: npx playwright test",
    "",
  ].join("\n");

  assert.deepEqual([...suitePlatforms([workflow])], ["linux"]);
});

test("meldet eine Bindung, die nirgends laeuft", () => {
  const root = world("tot", { runner: "ubuntu-24.04", runsSuite: true });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /vergleicht nur auf "darwin"/);
});

test("schweigt, wenn ein Job auf der gebundenen Plattform die Suite ausfuehrt", () => {
  const root = world("lebendig", { runner: "macos-15", runsSuite: true });

  assert.deepEqual(checkVisualBaselineReach(root), []);
});

test("meldet Bilder, die zur gebundenen Plattform nicht passen", () => {
  const root = world("falsche-bilder", {
    runner: "macos-15",
    runsSuite: true,
    images: ["a-linux.png"],
  });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /keines fuer "darwin"/);
});
