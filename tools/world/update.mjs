// Rewrites every file generated from the test world (tests/world/), the one command after any
// change to the world:
//
//   npm run world:update
//   npm run world:update -- --confirm-translation <key> [--confirm-translation <key> ...]
//
// It writes the shipped example world (src/quiltor/resources/example_world/), the typed ids
// (tests/world/ids.generated.ts), the lock (tests/world/world.lock.json) and the catalog
// (tests/world/CATALOG.md). --confirm-translation records that an English text is still right
// after its German source changed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CATALOG_FILE, renderCatalog } from "../../tests/world/catalog.mjs";
import { IDS_FILE, renderIdsFile } from "../../tests/world/ids.mjs";
import { LOCK_FILE, lockBytes, renderLock } from "../../tests/world/lock.mjs";
import { renderShipFiles } from "../../tests/world/ship.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: { "confirm-translation": { type: "string", multiple: true, default: [] } },
});

const lockPath = join(root, LOCK_FILE);
const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;

const files = {
  ...renderShipFiles(),
  [IDS_FILE]: renderIdsFile(),
  [LOCK_FILE]: lockBytes(renderLock(previous, new Set(values["confirm-translation"]))),
  [CATALOG_FILE]: await renderCatalog(),
};

for (const [path, bytes] of Object.entries(files)) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`wrote ${path}`);
}
