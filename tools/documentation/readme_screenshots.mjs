import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * The README screenshots as one contract: which views exist, in which languages, which files
 * they come from and how a picture is tied to the release it was taken for.
 *
 * capture_readme.mjs --lang <language> writes `docs/screenshots/<language>/manifest.json`; the
 * release preflight and `npm run check` read both back through checkReadmeScreenshots(). A
 * picture is current when
 *   - its language's manifest names the VERSION file's version,
 *   - every PNG is the file whose SHA-256 the manifest recorded, and
 *   - the script and the example world that produced it are unchanged (the inputs digest).
 * Each document shows the pictures of its own language only: the German README the German
 * interface, the English README the English one.
 * The pictures are taken on Windows, where releases are prepared (`npm run set-version`):
 * font rasterisation differs per platform, and the Linux release job only verifies.
 */

/** Every view the README shows, in the order the capture takes them. The one list. */
export const README_VIEWS = [
  "manuscript",
  "world-graph",
  "timeline-playback",
  "timeline-manager",
  "timeline-calendar",
  "places",
  "places-map",
  "storyboard",
  "shared-notes",
  "search",
  "versions",
];

/** Every language the pictures are taken in; each has its own folder and manifest. */
export const SCREENSHOT_LANGUAGES = ["de", "en"];

export const SCREENSHOT_DIRECTORY = "docs/screenshots";
export const MANIFEST_NAME = "manifest.json";
export const CAPTURE_PLATFORM = "win32";
export const CAPTURE_VIEWPORT = { width: 1440, height: 900 };

/** Markdown files whose image links count as README references, and the language each shows. */
export const DOCUMENT_LANGUAGES = {
  "README.md": "de",
  "README.en.md": "en",
  "DESIGN.md": "de",
};
export const REFERENCING_DOCUMENTS = Object.keys(DOCUMENT_LANGUAGES);

/**
 * What a picture is a function of, besides the product itself. The world is the shipped base
 * world (tests/world/ship.mjs), not its sources: a part that is never photographed can grow,
 * and the sources can be reworded, without making the pictures stale.
 */
export const CAPTURE_INPUTS = [
  "tools/documentation/capture_readme.mjs",
  "tools/documentation/readme_screenshots.mjs",
  "tools/documentation/settle.mjs",
  "src/quiltor/resources/example_world/de.json",
  "src/quiltor/resources/example_world/en.json",
  "src/quiltor/resources/example_world/harbour-map.png",
];

const IMAGE_LINK = /\]\((?:\.\/)?docs\/screenshots\/([^)\s]+\.png)\)/g;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function inputsDigest(root) {
  const hash = createHash("sha256");
  for (const file of CAPTURE_INPUTS) {
    const bytes = readFileSync(join(root, file));
    // Line endings are normalised so a Windows checkout and a Linux one agree; a picture is
    // hashed as the bytes it is.
    const content = file.endsWith(".png")
      ? bytes
      : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    hash.update(`${file}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function readVersion(root) {
  return readFileSync(join(root, "VERSION"), "utf8").trim();
}

export function languageDirectory(root, language) {
  return join(root, SCREENSHOT_DIRECTORY, language);
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

/** Image path below docs/screenshots (`de/places.png`) -> the documents that show it. */
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
  const base = join(root, SCREENSHOT_DIRECTORY);
  const referenced = referencedImages(root);
  const refresh = "run npm run screenshots:readme (npm run set-version does it for a release)";

  // Only the language folders belong here; a picture or manifest beside them is a leftover.
  if (existsSync(base)) {
    for (const name of readdirSync(base)) {
      const isLanguage =
        SCREENSHOT_LANGUAGES.includes(name) && statSync(join(base, name)).isDirectory();
      if (!isLanguage) {
        violations.push(
          `${SCREENSHOT_DIRECTORY}/${name} lies outside the language folders (${SCREENSHOT_LANGUAGES.join(", ")}).`,
        );
      }
    }
  }

  const present = new Set();
  for (const language of SCREENSHOT_LANGUAGES) {
    const directory = languageDirectory(root, language);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (name.endsWith(".png")) present.add(`${language}/${name}`);
    }
  }

  for (const [image, documents] of referenced) {
    if (!present.has(image)) {
      violations.push(
        `${documents.join(", ")} references ${SCREENSHOT_DIRECTORY}/${image}, which does not exist.`,
      );
    }
    const language = image.split("/")[0];
    for (const document of documents) {
      const expected = DOCUMENT_LANGUAGES[document];
      if (language !== expected) {
        violations.push(
          `${document} shows ${SCREENSHOT_DIRECTORY}/${image}, but it may only show pictures from ${SCREENSHOT_DIRECTORY}/${expected}/.`,
        );
      }
    }
  }
  for (const image of present) {
    if (!referenced.has(image)) {
      violations.push(
        `${SCREENSHOT_DIRECTORY}/${image} is not referenced by any of ${REFERENCING_DOCUMENTS.join(", ")}.`,
      );
    }
  }
  for (const language of SCREENSHOT_LANGUAGES) {
    for (const view of README_VIEWS) {
      if (!referenced.has(`${language}/${view}.png`)) {
        violations.push(
          `README view "${view}" is listed in README_VIEWS but no document shows it in "${language}".`,
        );
      }
    }
  }

  const version = readVersion(root);
  const digest = inputsDigest(root);
  for (const language of SCREENSHOT_LANGUAGES) {
    const folder = `${SCREENSHOT_DIRECTORY}/${language}`;
    const manifestPath = join(languageDirectory(root, language), MANIFEST_NAME);
    if (!existsSync(manifestPath)) {
      violations.push(`${folder}/${MANIFEST_NAME} is missing; ${refresh}.`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      violations.push(`${folder}/${MANIFEST_NAME} is not valid JSON: ${error.message}`);
      continue;
    }
    if (manifest.version !== version) {
      violations.push(
        `The "${language}" README screenshots were taken for ${manifest.version}, but VERSION is ${version}; ${refresh}.`,
      );
    }
    if (manifest.inputs !== digest) {
      violations.push(
        `The capture script or example world changed since the "${language}" screenshots were taken; ${refresh}.`,
      );
    }
    const recorded = manifest.images ?? {};
    const pictures = [...present]
      .filter((image) => image.startsWith(`${language}/`))
      .map((image) => image.slice(language.length + 1));
    for (const image of pictures) {
      if (!(image in recorded)) {
        violations.push(`${folder}/${image} is not recorded in its manifest; ${refresh}.`);
      } else if (recorded[image] !== sha256(readFileSync(join(root, folder, image)))) {
        violations.push(
          `${folder}/${image} differs from the picture the manifest recorded; ${refresh}.`,
        );
      }
    }
    for (const image of Object.keys(recorded)) {
      if (!pictures.includes(image)) {
        violations.push(`The ${folder} manifest records ${image}, which does not exist.`);
      }
    }
  }
  return violations;
}
