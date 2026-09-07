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

test("nennt die Plattform, die noch keinen Satz mitbringt", () => {
  const root = world("ohne-linux", { runner: "ubuntu-24.04", runsSuite: true });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /^linux: ein Job vergleicht dort/);
});

test("schweigt, wenn jede vergleichende Plattform ihren Satz hat", () => {
  const root = world("vollstaendig", {
    runner: "macos-15",
    runsSuite: true,
    images: ["a-darwin.png"],
  });

  assert.deepEqual(checkVisualBaselineReach(root), []);
});

test("nennt die Bilder, die einer Plattform gegenueber den anderen fehlen", () => {
  // The case the bootstrap run exists for: a design has changed and the affected images
  // were deleted per platform. "Some image is there" would have stayed silent here -- and
  // the run meant to fill the gap would have skipped itself.
  const root = world("halber-satz", {
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
  assert.match(violations[0], /^win32: 1 Bild\(er\) fehlen/);
  assert.ok(violations[0].includes("(b)"), violations[0]);
});

test("meldet, wenn ueberhaupt kein Job die Suite ausfuehrt", () => {
  const root = world("niemand", { runner: "macos-15", runsSuite: false });
  const violations = checkVisualBaselineReach(root);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Kein Job fuehrt/);
});

test("loest eine Runner-Matrix auf, statt sie zu uebersehen", () => {
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

test("zaehlt eine Matrix nicht mit, wenn der Job die Suite gar nicht startet", () => {
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
