import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

/*
 * Links between Markdown files, checked across file boundaries.
 *
 * markdownlint (MD051) already checks `#anchor` links inside one file. This checks what it
 * cannot: a relative link names a file or folder that exists, an anchor on another Markdown
 * file exists there, and an absolute link to this repository on GitHub
 * (https://github.com/Tim3399/quiltor/blob/main/...) is read as the local file it names --
 * the READMEs use those so the links also work on PyPI.
 *
 * Anchors follow GitHub's derivation from headings (lower case, punctuation dropped, spaces
 * to hyphens, a numeric suffix for repeats) plus explicit `<a id>`/`<a name>` targets.
 */

export const REPOSITORY_URL = "https://github.com/Tim3399/quiltor/blob/main/";

/** Known breaks that are not ours to fix, each with its reason. Keep it short. */
export const EXCEPTIONS = [];

const FENCE = /^\s*(```|~~~)/;
const LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** GitHub's heading anchor: what remains of the visible text, lower case, hyphenated. */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every line outside fenced code, with inline code blanked so its brackets are not links. */
function proseLines(text) {
  const lines = [];
  let fenced = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced)
      lines.push([index + 1, line.replace(/`[^`]*`/g, (code) => " ".repeat(code.length))]);
  }
  return lines;
}

const anchorCache = new Map();

export function anchorsOf(path) {
  if (anchorCache.has(path)) return anchorCache.get(path);
  const anchors = new Set();
  const seen = new Map();
  let fenced = false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slug(heading[1]);
      const count = seen.get(base) ?? 0;
      anchors.add(count === 0 ? base : `${base}-${count}`);
      seen.set(base, count + 1);
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);
  }
  anchorCache.set(path, anchors);
  return anchors;
}

/** The Markdown files git knows about, minus build output and vendored trees. */
export function markdownFiles(root) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return listed
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("dist/") && !file.includes("node_modules/"))
    .filter((file) => existsSync(join(root, file)));
}

/** Developer-facing sentences, one per broken link; empty when every link resolves. */
export function checkMarkdownLinks(root, files = markdownFiles(root)) {
  anchorCache.clear();
  const problems = [];
  for (const file of files) {
    const path = join(root, file);
    for (const [line, text] of proseLines(readFileSync(path, "utf8"))) {
      for (const match of text.matchAll(LINK)) {
        let target = match[1];
        if (target.startsWith(REPOSITORY_URL)) {
          target = `/${target.slice(REPOSITORY_URL.length)}`;
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
          continue;
        }
        const [rawPath, fragment] = target.split("#", 2);
        let destination = path;
        if (rawPath) {
          const decoded = decodeURIComponent(rawPath);
          destination = decoded.startsWith("/")
            ? join(root, decoded)
            : normalize(join(dirname(path), decoded));
          if (relative(root, destination).startsWith("..")) {
            problems.push(`${file}:${line}: ${match[1]} leaves the repository.`);
            continue;
          }
          if (!existsSync(destination)) {
            problems.push(`${file}:${line}: ${match[1]} names a file that does not exist.`);
            continue;
          }
        }
        if (
          fragment &&
          destination.endsWith(".md") &&
          statSync(destination).isFile() &&
          !anchorsOf(destination).has(decodeURIComponent(fragment))
        ) {
          const where = relative(root, destination).replace(/\\/g, "/");
          problems.push(`${file}:${line}: ${match[1]} has no anchor "#${fragment}" in ${where}.`);
        }
      }
    }
  }
  return problems.filter((problem) => !EXCEPTIONS.some(({ pattern }) => pattern.test(problem)));
}
