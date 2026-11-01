import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The README screenshots as one contract: which views exist, which files they come from and
 * how a picture is tied to the release it was taken for.
 *
 * capture_readme.mjs writes `docs/screenshots/manifest.json`; the release preflight and
 * `npm run check` read it back through checkReadmeScreenshots(). A picture is current when
 *   - the manifest names the VERSION file's version,
 *   - every PNG is the file whose SHA-256 the manifest recorded, and
 *   - the script and fixture that produced it are unchanged (the inputs digest).
 * The pictures are taken on Windows, where releases are prepared (`npm run set-version`):
 * font rasterisation differs per platform, and the Linux release job only verifies.
 */

/** Every view the README shows, in the order the capture takes them. The one list. */
export const README_VIEWS = [
  "manuscript",
  "world-graph",
  "timeline-playback",
  "timeline-manager",
  "places",
  "storyboard",
  "shared-notes",
];

export const SCREENSHOT_DIRECTORY = "docs/screenshots";
export const MANIFEST_NAME = "manifest.json";
export const CAPTURE_PLATFORM = "win32";
export const CAPTURE_VIEWPORT = { width: 1440, height: 900 };

/** Markdown files whose image links count as README references. */
export const REFERENCING_DOCUMENTS = ["README.md", "README.en.md", "DESIGN.md"];

/** What a picture is a function of, besides the product itself. */
export const CAPTURE_INPUTS = [
  "tools/documentation/capture_readme.mjs",
  "tools/documentation/readme_fixture.mjs",
  "tools/documentation/readme_screenshots.mjs",
];

const IMAGE_LINK = /\]\((?:\.\/)?docs\/screenshots\/([^)\s]+\.png)\)/g;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function inputsDigest(root) {
  const hash = createHash("sha256");
  for (const file of CAPTURE_INPUTS) {
    // Line endings are normalised so a Windows checkout and a Linux one agree.
    const text = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
    hash.update(`${file}\0${text}\0`);
  }
  return hash.digest("hex");
}

export function readVersion(root) {
  return readFileSync(join(root, "VERSION"), "utf8").trim();
}

export function buildManifest({ root, directory, version }) {
  const images = {};
  for (const view of README_VIEWS) {
    images[`${view}.png`] = sha256(readFileSync(join(directory, `${view}.png`)));
  }
  return {
    version,
    platform: CAPTURE_PLATFORM,
    viewport: CAPTURE_VIEWPORT,
    inputs: inputsDigest(root),
    images,
  };
}

export function referencedImages(root) {
  const references = new Map();
  for (const document of REFERENCING_DOCUMENTS) {
    const path = join(root, document);
    if (!existsSync(path)) continue;
    for (const match of readFileSync(path, "utf8").matchAll(IMAGE_LINK)) {
      references.set(match[1], [...(references.get(match[1]) ?? []), document]);
    }
  }
  return references;
}

/** Violations as developer-facing sentences; empty when README and pictures agree. */
export function checkReadmeScreenshots(root) {
  const violations = [];
  const directory = join(root, SCREENSHOT_DIRECTORY);
  const present = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith(".png"))
    : [];
  const referenced = referencedImages(root);

  for (const [image, documents] of referenced) {
    if (!present.includes(image)) {
      violations.push(
        `${documents.join(", ")} references ${SCREENSHOT_DIRECTORY}/${image}, which does not exist.`,
      );
    }
  }
  for (const image of present) {
    if (!referenced.has(image)) {
      violations.push(
        `${SCREENSHOT_DIRECTORY}/${image} is not referenced by any of ${REFERENCING_DOCUMENTS.join(", ")}.`,
      );
    }
  }
  for (const view of README_VIEWS) {
    if (!referenced.has(`${view}.png`)) {
      violations.push(`README view "${view}" is listed in README_VIEWS but no document shows it.`);
    }
  }

  const manifestPath = join(directory, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    violations.push(
      `${SCREENSHOT_DIRECTORY}/${MANIFEST_NAME} is missing; run npm run screenshots:readme.`,
    );
    return violations;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    violations.push(`${SCREENSHOT_DIRECTORY}/${MANIFEST_NAME} is not valid JSON: ${error.message}`);
    return violations;
  }

  const version = readVersion(root);
  const refresh = "run npm run screenshots:readme (npm run set-version does it for a release)";
  if (manifest.version !== version) {
    violations.push(
      `The README screenshots were taken for ${manifest.version}, but VERSION is ${version}; ${refresh}.`,
    );
  }
  if (manifest.inputs !== inputsDigest(root)) {
    violations.push(
      `The capture script or fixture changed since the screenshots were taken; ${refresh}.`,
    );
  }
  const recorded = manifest.images ?? {};
  for (const image of present) {
    if (!(image in recorded)) {
      violations.push(`${image} is not recorded in the manifest; ${refresh}.`);
    } else if (recorded[image] !== sha256(readFileSync(join(directory, image)))) {
      violations.push(`${image} differs from the picture the manifest recorded; ${refresh}.`);
    }
  }
  for (const image of Object.keys(recorded)) {
    if (!present.includes(image)) {
      violations.push(`The manifest records ${image}, which does not exist.`);
    }
  }
  return violations;
}
