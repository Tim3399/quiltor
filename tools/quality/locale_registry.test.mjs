import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { analyzeLocaleRegistry, closeLocaleRegistryParser } from "./locale_registry.mjs";

const directories = [];

function analyze(source, expectedLocales) {
  const directory = mkdtempSync(join(tmpdir(), "quiltor-locale-registry-"));
  directories.push(directory);
  const file = join(directory, "index.ts");
  writeFileSync(file, source, "utf8");
  return analyzeLocaleRegistry({ file, source, expectedLocales });
}

after(() => {
  closeLocaleRegistryParser();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test("accepts exact catalog and manifest registrations", () => {
  const result = analyze(
    `
      import de from "./de";
      import deManifest from "./de/manifest.json";
      import en from "./en";
      import enManifest from "./en/manifest.json";
      export const localePackages = [
        { manifest: deManifest, catalog: de },
        { manifest: enManifest, catalog: en },
      ] as const;
    `,
    ["de", "en"],
  );
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.locales, ["de", "en"]);
});

test("rejects a catalog that is imported but absent from the runtime array", () => {
  const result = analyze(
    `
      import de from "./de";
      import deManifest from "./de/manifest.json";
      import es from "./es";
      import esManifest from "./es/manifest.json";
      export const localePackages = [{ manifest: deManifest, catalog: de }] as const;
      void es; void esManifest;
    `,
    ["de", "es"],
  );
  assert.match(result.violations.join("\n"), /missing runtime locale registrations: es/);
});

test("ignores registration-looking comments and rejects duplicate or mismatched pairs", () => {
  const result = analyze(
    `
      import de from "./de";
      import deManifest from "./de/manifest.json";
      import enManifest from "./en/manifest.json";
      // { manifest: esManifest, catalog: es }
      export const localePackages = [
        { manifest: deManifest, catalog: de },
        { manifest: deManifest, catalog: de },
        { manifest: enManifest, catalog: de },
      ] as const;
    `,
    ["de", "es"],
  );
  const failures = result.violations.join("\n");
  assert.match(failures, /duplicate locale registrations: de/);
  assert.match(failures, /must pair default imports/);
  assert.match(failures, /missing runtime locale registrations: es/);
});
