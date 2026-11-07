import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  CAPTURE_INPUTS,
  checkReadmeScreenshots,
  inputsDigest,
  MANIFEST_NAME,
  README_VIEWS,
  SCREENSHOT_DIRECTORY,
  SCREENSHOT_LANGUAGES,
} from "../documentation/readme_screenshots.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const folder = (root, language) => join(root, SCREENSHOT_DIRECTORY, language);
const imageLines = (language) =>
  README_VIEWS.map((view) => `![View](docs/screenshots/${language}/${view}.png)`).join("\n\n");

/**
 * A minimal repository that satisfies the contract: both READMEs, DESIGN.md, the pictures of
 * both languages, a manifest each, VERSION.
 */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "quiltor-readme-shots-"));
  scratch.push(root);
  for (const file of CAPTURE_INPUTS) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    cpSync(join(repositoryRoot, file), join(root, file));
  }
  writeFileSync(join(root, "VERSION"), "1.2.3\n");
  for (const language of SCREENSHOT_LANGUAGES) {
    mkdirSync(folder(root, language), { recursive: true });
    const images = {};
    for (const view of README_VIEWS) {
      const bytes = Buffer.from(`${language} picture of ${view}`);
      writeFileSync(join(folder(root, language), `${view}.png`), bytes);
      images[`${view}.png`] = digest(bytes);
    }
    writeManifest(root, language, { version: "1.2.3", inputs: inputsDigest(root), images });
  }
  writeFileSync(join(root, "README.md"), imageLines("de"));
  writeFileSync(join(root, "README.en.md"), imageLines("en"));
  writeFileSync(join(root, "DESIGN.md"), "![Manuskript](docs/screenshots/de/manuscript.png)");
  return root;
}

function writeManifest(root, language, manifest) {
  writeFileSync(join(folder(root, language), MANIFEST_NAME), JSON.stringify(manifest));
}

function readManifest(root, language) {
  return JSON.parse(readFileSync(join(folder(root, language), MANIFEST_NAME), "utf8"));
}

function violationsMatching(root, pattern) {
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) => pattern.test(line)),
    `expected ${pattern} among:\n${violations.join("\n")}`,
  );
  return violations;
}

test("both READMEs, their pictures and a manifest per language agree", () => {
  assert.deepEqual(checkReadmeScreenshots(workspace()), []);
});

test("a referenced picture that does not exist is a violation", () => {
  const root = workspace();
  rmSync(join(folder(root, "en"), "places.png"));
  violationsMatching(root, /references docs\/screenshots\/en\/places\.png, which does not exist/);
});

test("a picture that no document references is a violation", () => {
  const root = workspace();
  writeFileSync(join(folder(root, "de"), "orphan.png"), "x");
  violationsMatching(root, /de\/orphan\.png is not referenced/);
});

test("the German README may only show German pictures", () => {
  const root = workspace();
  writeFileSync(
    join(root, "README.md"),
    imageLines("de").replace("de/places.png", "en/places.png"),
  );
  violationsMatching(
    root,
    /README\.md shows docs\/screenshots\/en\/places\.png, but it may only show pictures from docs\/screenshots\/de\//,
  );
});

test("the English README may only show English pictures", () => {
  const root = workspace();
  writeFileSync(
    join(root, "README.en.md"),
    imageLines("en").replace("en/storyboard.png", "de/storyboard.png"),
  );
  violationsMatching(root, /README\.en\.md shows docs\/screenshots\/de\/storyboard\.png/);
});

test("DESIGN.md shows the German pictures", () => {
  const root = workspace();
  writeFileSync(join(root, "DESIGN.md"), "![Manuscript](docs/screenshots/en/manuscript.png)");
  violationsMatching(root, /DESIGN\.md shows docs\/screenshots\/en\/manuscript\.png/);
});

test("a picture outside the language folders is a violation", () => {
  const root = workspace();
  writeFileSync(join(root, SCREENSHOT_DIRECTORY, "manuscript.png"), "old");
  writeFileSync(
    join(root, "README.md"),
    `${imageLines("de")}\n![x](docs/screenshots/manuscript.png)`,
  );
  const violations = violationsMatching(
    root,
    /docs\/screenshots\/manuscript\.png lies outside the language folders/,
  );
  assert.ok(
    violations.some((line) => /may only show pictures from docs\/screenshots\/de\//.test(line)),
  );
});

test("every view has to be shown in every language", () => {
  const root = workspace();
  writeFileSync(
    join(root, "README.en.md"),
    imageLines("en").replace("![View](docs/screenshots/en/timeline-manager.png)", ""),
  );
  violationsMatching(
    root,
    /README view "timeline-manager" is listed in README_VIEWS but no document shows it in "en"/,
  );
});

test("pictures taken for another version are refused, per language", () => {
  const root = workspace();
  const manifest = readManifest(root, "en");
  manifest.version = "1.1.0";
  writeManifest(root, "en", manifest);
  const violations = violationsMatching(
    root,
    /The "en" README screenshots were taken for 1\.1\.0, but VERSION is 1\.2\.3/,
  );
  assert.ok(!violations.some((line) => /"de" README screenshots/.test(line)));
});

test("a picture edited after the capture no longer matches its manifest", () => {
  const root = workspace();
  writeFileSync(join(folder(root, "de"), "manuscript.png"), "a different picture");
  violationsMatching(
    root,
    /docs\/screenshots\/de\/manuscript\.png differs from the picture the manifest recorded/,
  );
});

test("a changed example world makes the pictures of both languages stale", () => {
  const root = workspace();
  const texts = join(root, "tools/documentation/example_world/texts.en.mjs");
  writeFileSync(texts, `${readFileSync(texts, "utf8")}\n// edited`);
  const violations = checkReadmeScreenshots(root);
  for (const language of SCREENSHOT_LANGUAGES) {
    assert.ok(
      violations.some((line) =>
        line.includes(`example world changed since the "${language}" screenshots`),
      ),
      violations.join("\n"),
    );
  }
});

test("a changed harbour map makes the pictures stale", () => {
  const root = workspace();
  const map = join(root, "tools/documentation/example_world/harbour-map.png");
  const bytes = readFileSync(map);
  bytes[bytes.length - 20] ^= 0xff;
  writeFileSync(map, bytes);
  violationsMatching(root, /example world changed since the "de" screenshots/);
});

test("line endings alone do not make the pictures stale", () => {
  const root = workspace();
  const texts = join(root, "tools/documentation/example_world/texts.de.mjs");
  writeFileSync(texts, readFileSync(texts, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(checkReadmeScreenshots(root), []);
});

test("a missing manifest is a violation", () => {
  const root = workspace();
  rmSync(join(folder(root, "en"), MANIFEST_NAME));
  violationsMatching(root, /docs\/screenshots\/en\/manifest\.json is missing/);
});

test("a manifest entry without a picture is a violation", () => {
  const root = workspace();
  const manifest = readManifest(root, "de");
  manifest.images["ghost.png"] = digest("ghost");
  writeManifest(root, "de", manifest);
  violationsMatching(
    root,
    /docs\/screenshots\/de manifest records ghost\.png, which does not exist/,
  );
});

test("the repository itself passes", () => {
  assert.deepEqual(checkReadmeScreenshots(repositoryRoot), []);
});
