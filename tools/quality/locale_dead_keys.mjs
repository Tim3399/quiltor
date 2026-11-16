// Finds catalog keys that no product source mentions, Python included: the assistant backend builds
// German texts from the catalog too. A key counts as used when its identifier appears as a whole
// word anywhere in the searched code, so a dynamic lookup that spells the key out (a
// `labelKey: "storyboardTitle"` table) is never reported. Only a key assembled by string
// concatenation could slip through as dead, and none exists.
//
// Tests and tools are not searched: a key that only a test or a script names is dead in the
// product, and a test that asserts the text of such a key would otherwise keep it alive (T-171).
// A key that the product reaches only through an unreachable branch is still not found this
// way; that needs a reader.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SEARCHED_ROOTS = ["packages", "apps", "src"];
const SEARCHED_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".py"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "test-results", "playwright-report"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|[/\\])test_[^/\\]*\.py$/;

/** Concatenated text of every product code file under the searched roots, relative to `root`. */
export function readSearchedCode(root) {
  const parts = [];
  const visit = (path) => {
    if (SKIPPED_DIRECTORIES.has(path.split(/[/\\]/).at(-1))) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (SEARCHED_EXTENSIONS.has(extname(path)) && !TEST_FILE.test(path)) {
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
