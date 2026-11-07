// Rewrites every file generated from the test world (tests/world/).
//
//   npm run world:update
//
// Today that is the shipped example world under src/quiltor/resources/example_world/ and
// the typed ids in tests/world/ids.generated.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IDS_FILE, renderIdsFile } from "../../tests/world/ids.mjs";
import { renderShipFiles } from "../../tests/world/ship.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

for (const [path, bytes] of Object.entries({
  ...renderShipFiles(),
  [IDS_FILE]: renderIdsFile(),
})) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`wrote ${path}`);
}
