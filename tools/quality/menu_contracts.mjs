import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

const roots = Object.freeze([
  "packages/client/src/app",
  "packages/client/src/modules",
  "packages/client/src/shared",
]);

function normalized(path) {
  return path.split(sep).join("/");
}

export function isMenuContractProductFile(file) {
  const path = normalized(file);
  if (![".ts", ".tsx"].includes(extname(path).toLowerCase())) return false;
  const segments = path.split("/");
  if (segments.some((segment) => ["test", "tests", "__tests__"].includes(segment.toLowerCase()))) {
    return false;
  }
  return !/\.(?:test|spec|testSupport)\.(?:ts|tsx)$/i.test(segments.at(-1));
}

export function discoverMenuContractFiles(repositoryRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isMenuContractProductFile(path)) files.push(path);
    }
  };
  for (const root of roots) {
    const directory = resolve(repositoryRoot, root);
    if (!existsSync(directory)) throw new Error(`Menu-contract scope is missing: ${root}`);
    visit(directory);
  }
  return files.sort((left, right) => normalized(left).localeCompare(normalized(right)));
}

function menuItemAttributeBlocks(source) {
  const blocks = [];
  let cursor = 0;
  while (cursor >= 0) {
    cursor = source.indexOf("<MenuItem", cursor);
    if (cursor < 0) break;
    const start = cursor + "<MenuItem".length;
    let braces = 0;
    let quote = "";
    let escaped = false;
    let index = start;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        braces += 1;
      } else if (character === "}") {
        braces = Math.max(0, braces - 1);
      } else if (character === ">" && braces === 0) {
        blocks.push(source.slice(start, index));
        index += 1;
        break;
      }
    }
    cursor = Math.max(index, start);
  }
  return blocks;
}

/** Product menus must consume the complete public pattern instead of rebuilding its internals. */
export function analyzeMenuContractSource(source) {
  const violations = [];
  if (/<Menu(?:\s|>)/u.test(source)) {
    violations.push("renders <Menu> directly; use DropdownMenu or SelectionMenu");
  }
  if (/aria-haspopup\s*=\s*(?:["']menu["']|\{["']menu["']\})/u.test(source)) {
    violations.push("owns aria-haspopup=menu directly; spread a design-pattern trigger contract");
  }
  if (
    /<details\b[^>]*className\s*=\s*["'][^"']*(?:assistant-chapter-picker|timeline-time-settings)[^"']*["']/u.test(
      source,
    )
  ) {
    violations.push("uses a retired feature-owned dropdown class; use a public design overlay");
  }

  for (const attributes of menuItemAttributeBlocks(source)) {
    if (!/\blabel\s*=/u.test(attributes)) {
      violations.push("renders MenuItem without the structured label prop");
    }
    if (
      /\bicon\s*=\s*\{\s*<(?:[\w.]*?(?:Trash|Delete)[\w.]*)\b/iu.test(attributes) &&
      !/\btone\s*=\s*["']danger["']/u.test(attributes)
    ) {
      violations.push('renders a destructive MenuItem icon without tone="danger"');
    }
  }
  return violations;
}

export function scanMenuContracts(repositoryRoot) {
  const violations = [];
  for (const file of discoverMenuContractFiles(repositoryRoot)) {
    for (const message of analyzeMenuContractSource(readFileSync(file, "utf8"))) {
      violations.push(`${normalized(relative(repositoryRoot, file))}: ${message}`);
    }
  }
  return violations;
}

export function formatMenuContractReport(violations) {
  return violations.length
    ? `Menu design contract failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}`
    : "Menu design contract holds.";
}
