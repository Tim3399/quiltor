import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { checkVisualBaselineReach, suitePlatforms } from "./visual_baseline_reach.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-baseline-reach-"));

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function world(name, { runner, runsSuite, images = ["a-darwin.png"] }) {
  const root = resolve(fixtureRoot, name);
  mkdirSync(resolve(root, ".github/workflows"), { recursive: true });
  mkdirSync(resolve(root, "tests/e2e/visual-baseline.spec.ts-snapshots"), { recursive: true });
  writeFileSync(resolve(root, "tests/e2e/visual-baseline.spec.ts"), "// spec", "utf8");
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

test("counts only jobs that actually run the suite", () => {
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

test("names the platform that brings no set yet", () => {
  const root = world("without-linux", { runner: "ubuntu-24.04", runsSuite: true });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /^linux: a job compares there/);
});

test("stays silent when every comparing platform has its set", () => {
  const root = world("complete", {
    runner: "macos-15",
    runsSuite: true,
    images: ["a-darwin.png"],
  });

  assert.deepEqual(checkVisualBaselineReach(root), []);
});

test("names the images a platform is missing next to the others", () => {
  // The case the bootstrap run exists for: a design has changed and the affected images
  // were deleted per platform. "Some image is there" would have stayed silent here -- and
  // the run meant to fill the gap would have skipped itself.
  const root = world("half-a-set", {
    runner: "${{ matrix.os }}",
    runsSuite: true,
    images: ["a-darwin.png", "b-darwin.png", "a-win32.png"],
  });
  writeFileSync(
    resolve(root, ".github/workflows/test.yml"),
    [
      "jobs:",
      "  browser:",
      "    runs-on: ${{ matrix.os }}",
      "    strategy:",
      "      matrix:",
      "        os: [macos-15, windows-2025]",
      "    steps:",
      "      - run: npx playwright test",
      "",
    ].join("\n"),
    "utf8",
  );
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /^win32: 1 image\(s\) missing/);
  assert.ok(violations[0].includes("(b)"), violations[0]);
});

test("reports when no job runs the suite at all", () => {
  const root = world("niemand", { runner: "macos-15", runsSuite: false });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /No job runs/);
});

test("resolves a runner matrix instead of overlooking it", () => {
  const workflow = [
    "jobs:",
    "  browser:",
    "    runs-on: ${{ matrix.os }}",
    "    strategy:",
    "      matrix:",
    "        os: [macos-15, windows-2025]",
    "    steps:",
    "      - run: npx playwright test",
    "",
  ].join("\n");

  assert.deepEqual([...suitePlatforms([workflow])].sort(), ["darwin", "win32"]);
});

test("does not count a matrix when the job never starts the suite", () => {
  const workflow = [
    "jobs:",
    "  package:",
    "    runs-on: ${{ matrix.os }}",
    "    strategy:",
    "      matrix:",
    "        os: [macos-15, windows-2025]",
    "    steps:",
    "      - run: npm run build",
    "",
  ].join("\n");

  assert.deepEqual([...suitePlatforms([workflow])], []);
});
