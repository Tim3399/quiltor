// The ids of the test world as a typed TypeScript constant, so a spec writes
// `world.ids.figures.mara` instead of a string. Generated into ids.generated.ts by
// `npm run world:update`; world.test.mjs fails while the file is stale.

import { buildExampleWorld, PARTS } from "./index.mjs";
import { NAMED as LARGE_NAMED } from "./parts/large.mjs";

export const IDS_FILE = "tests/world/ids.generated.ts";

const camel = (id) => id.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());

export function renderIdsFile() {
  const { manuscript, figures, storyboards } = buildExampleWorld("de", { include: PARTS });
  const groups = {
    figures: figures.nodes.map((node) => node.id),
    relationships: figures.edges.map((edge) => edge.id),
    moments: figures.timeline.map((moment) => moment.id),
    chapters: [
      ...manuscript.chapters.map((chapter) => chapter.id),
      ...manuscript.trash.map((entry) => entry.chapter.id),
    ],
    folders: manuscript.structure.folders.map((folder) => folder.id),
    boards: storyboards.boards.map((board) => board.id),
    cards: storyboards.nodes.map((card) => card.id),
  };
  // The large part names only its chapters, its folder, its map, its boards and its first 20
  // people one by one; everything else of it is listed per group, in order (F-339-6).
  const isLarge = (id) => id.startsWith("l-");
  const lists = {};
  for (const [group, ids] of Object.entries(groups)) {
    const unnamed = ids.filter((id) => isLarge(id) && !LARGE_NAMED.has(id));
    if (unnamed.length) lists[group] = unnamed;
    groups[group] = ids.filter((id) => !unnamed.includes(id));
  }
  const lines = [
    "// Generated from tests/world by npm run world:update. Do not edit.",
    '// Ids starting with x- belong to the check part: seed with include: ["base", "edge"].',
    '// Ids starting with l- belong to the large part: seed with include: ["base", "large"].',
    "",
    "export const WORLD = {",
  ];
  for (const [group, ids] of Object.entries(groups)) {
    lines.push(`  ${group}: {`);
    for (const id of ids) lines.push(`    ${camel(id)}: ${JSON.stringify(id)},`);
    lines.push("  },");
  }
  lines.push("  large: {");
  for (const [group, ids] of Object.entries(lists)) {
    lines.push(`    ${group}: [`);
    for (const id of ids) lines.push(`      ${JSON.stringify(id)},`);
    lines.push("    ],");
  }
  lines.push("  },");
  lines.push("} as const;", "");
  return Buffer.from(lines.join("\n"), "utf8");
}
