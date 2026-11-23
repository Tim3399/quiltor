// Prints the test world for suites that are not JavaScript (T-339): the Python budget and
// import tests read the large part from here instead of a committed copy.
//
//   node tests/world/export.mjs --include base,large --lang de             JSON of the world
//   node tests/world/export.mjs --include base,large --folder l-novel --format md
//   node tests/world/export.mjs --include base,large --folder l-novel --format txt
//
// JSON is the world as buildExampleWorld returns it. Markdown and text hold the chapters of
// one folder in order, each as its title and its body: "# title" in Markdown, the bare title
// line in text.

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildExampleWorld } from "./index.mjs";

export function exportWorld({ include = ["base"], lang = "de", format = "json", folder = "" }) {
  const world = buildExampleWorld(lang, { include });
  if (format === "json") return `${JSON.stringify(world)}\n`;
  const { chapters, structure } = world.manuscript;
  const order = structure.items
    .filter((item) => item.kind === "chapter" && (!folder || item.parentFolderId === folder))
    .sort((a, b) => a.position - b.position)
    .map((item) => chapters.find((chapter) => chapter.id === item.chapterId))
    .filter(Boolean);
  if (!order.length) throw new Error(`The folder "${folder}" holds no chapter.`);
  const heading = format === "md" ? (title) => `# ${title}` : (title) => title;
  if (format !== "md" && format !== "txt") throw new Error(`Unknown format "${format}".`);
  return `${order.map((chapter) => `${heading(chapter.title)}\n\n${chapter.body}`).join("\n\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      include: { type: "string", default: "base" },
      lang: { type: "string", default: "de" },
      format: { type: "string", default: "json" },
      folder: { type: "string", default: "" },
    },
  });
  process.stdout.write(
    exportWorld({ ...values, include: values.include.split(",").filter(Boolean) }),
  );
}
