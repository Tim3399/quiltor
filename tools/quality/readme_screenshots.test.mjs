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
} from "../documentation/readme_screenshots.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A minimal repository that satisfies the contract: README, pictures, manifest, VERSION. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "quiltor-readme-shots-"));
  scratch.push(root);
  for (const file of CAPTURE_INPUTS) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    cpSync(join(repositoryRoot, file), join(root, file));
  }
  writeFileSync(join(root, "VERSION"), "1.2.3\n");
  mkdirSync(join(root, SCREENSHOT_DIRECTORY), { recursive: true });
  const images = {};
  for (const view of README_VIEWS) {
    const bytes = Buffer.from(`picture of ${view}`);
    writeFileSync(join(root, SCREENSHOT_DIRECTORY, `${view}.png`), bytes);
    images[`${view}.png`] = digest(bytes);
  }
  writeFileSync(
    join(root, "README.md"),
    README_VIEWS.map((view) => `![Ansicht](docs/screenshots/${view}.png)`).join("\n\n"),
  );
  writeManifest(root, { version: "1.2.3", inputs: inputsDigest(root), images });
  return root;
}

function writeManifest(root, manifest) {
  writeFileSync(join(root, SCREENSHOT_DIRECTORY, MANIFEST_NAME), JSON.stringify(manifest));
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, SCREENSHOT_DIRECTORY, MANIFEST_NAME), "utf8"));
}

test("a README, its pictures and a manifest for the current version agree", () => {
  assert.deepEqual(checkReadmeScreenshots(workspace()), []);
});

test("a referenced picture that does not exist is a violation", () => {
  const root = workspace();
  rmSync(join(root, SCREENSHOT_DIRECTORY, "places.png"));
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) =>
      /references docs\/screenshots\/places\.png, which does not exist/.test(line),
    ),
    violations.join("\n"),
  );
});

test("a picture that no document references is a violation", () => {
  const root = workspace();
  writeFileSync(join(root, SCREENSHOT_DIRECTORY, "orphan.png"), "x");
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) => /orphan\.png is not referenced/.test(line)),
    violations.join("\n"),
  );
});

test("pictures taken for another version are refused", () => {
  const root = workspace();
  writeFileSync(join(root, "VERSION"), "1.3.0\n");
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) => /taken for 1\.2\.3, but VERSION is 1\.3\.0/.test(line)),
    violations.join("\n"),
  );
});

test("a picture edited after the capture no longer matches the manifest", () => {
  const root = workspace();
  writeFileSync(join(root, SCREENSHOT_DIRECTORY, "manuscript.png"), "a different picture");
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) =>
      /manuscript\.png differs from the picture the manifest recorded/.test(line),
    ),
    violations.join("\n"),
  );
});

test("a changed capture script or fixture makes the pictures stale", () => {
  const root = workspace();
  const fixture = join(root, "tools/documentation/readme_fixture.mjs");
  writeFileSync(fixture, `${readFileSync(fixture, "utf8")}\n// edited`);
  const violations = checkReadmeScreenshots(root);
  assert.ok(
    violations.some((line) => /capture script or fixture changed/.test(line)),
    violations.join("\n"),
  );
});

test("line endings alone do not make the pictures stale", () => {
  const root = workspace();
  const fixture = join(root, "tools/documentation/readme_fixture.mjs");
  writeFileSync(fixture, readFileSync(fixture, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(checkReadmeScreenshots(root), []);
});

test("a missing manifest is a violation", () => {
  const root = workspace();
  rmSync(join(root, SCREENSHOT_DIRECTORY, MANIFEST_NAME));
  assert.match(checkReadmeScreenshots(root).join("\n"), /manifest\.json is missing/);
});

test("a manifest entry without a picture is a violation", () => {
  const root = workspace();
  const manifest = readManifest(root);
  manifest.images["ghost.png"] = digest("ghost");
  writeManifest(root, manifest);
  assert.match(checkReadmeScreenshots(root).join("\n"), /records ghost\.png, which does not exist/);
});

test("the repository itself passes", () => {
  assert.deepEqual(checkReadmeScreenshots(repositoryRoot), []);
});
