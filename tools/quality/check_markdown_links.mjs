import { resolve } from "node:path";
import { checkMarkdownLinks, markdownFiles } from "./markdown_links.mjs";

const root = resolve(".");
const files = markdownFiles(root);
const problems = checkMarkdownLinks(root, files);
if (problems.length) {
  console.error("Markdown links that do not resolve:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Every link across ${files.length} Markdown files resolves.`);
