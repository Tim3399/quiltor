// Finds catalog keys that no source file mentions, Python included: the assistant backend builds
// German texts from the catalog too. A key counts as used when its identifier appears as a whole
// word anywhere in the searched code, so a dynamic lookup that spells the key
// out (a `labelKey: "storyboardTitle"` table, a test that names it) is never reported. Only a key
// assembled by string concatenation could slip through as dead, and none exists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SEARCHED_ROOTS = ["packages", "tests", "tools", "apps", "src"];
const SEARCHED_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".py"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "test-results", "playwright-report"]);

/** Concatenated text of every code file under the searched roots, relative to `root`. */
export function readSearchedCode(root) {
  const parts = [];
  const visit = (path) => {
    if (SKIPPED_DIRECTORIES.has(path.split(/[/\\]/).at(-1))) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (SEARCHED_EXTENSIONS.has(extname(path))) {
      parts.push(readFileSync(path, "utf8"));
    }
  };
  for (const name of SEARCHED_ROOTS) visit(join(root, name));
  return parts.join("\n");
}

/** The keys of `keys` that do not occur as a whole word in `code`, in input order. */
export function findDeadKeys(keys, code) {
  const words = new Set(code.match(/[A-Za-z_$][\w$]*/g));
  return [...keys].filter((key) => !words.has(key));
}
