// The example world as Quiltor ships it: the base world per language as one JSON file each,
// plus the harbour map, under src/quiltor/resources/example_world/. Only the base world ships;
// every other part of the test world stays in the repository.
//
// The files are generated (`npm run world:update`) and checked in. world.test.mjs fails while
// they differ from what this module renders, and the README pictures are hashed over them.

import { readFileSync } from "node:fs";
import {
  buildExampleWorld,
  exampleWorldTitle,
  HARBOUR_MAP_FILE,
  harbourMapId,
  LANGUAGES,
} from "./index.mjs";

export const SHIP_DIRECTORY = "src/quiltor/resources/example_world";
export const SHIP_FORMAT = "quiltor.example-world.v1";
const SHIP_MAP_NAME = "harbour-map.png";

/** The parts that ship. Never more than the base world. */
const SHIPPED_PARTS = ["base"];

/** Repository path -> bytes of every shipped file. */
export function renderShipFiles() {
  const files = {};
  for (const lang of LANGUAGES) {
    const { manuscript, figures, storyboards } = buildExampleWorld(lang, {
      include: SHIPPED_PARTS,
    });
    const document = {
      format: SHIP_FORMAT,
      lang,
      title: exampleWorldTitle(lang),
      mapImage: { file: SHIP_MAP_NAME, id: harbourMapId() },
      manuscript,
      storyWorld: figures,
      storyboards,
    };
    files[`${SHIP_DIRECTORY}/${lang}.json`] = Buffer.from(
      `${JSON.stringify(canonical(document), null, 2)}\n`,
      "utf8",
    );
  }
  files[`${SHIP_DIRECTORY}/${SHIP_MAP_NAME}`] = readFileSync(HARBOUR_MAP_FILE);
  return files;
}

/** The same value with every object's keys sorted, so the file is stable byte for byte. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
