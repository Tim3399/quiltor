import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = join(process.cwd(), "packages/client/src");
const designRoot = join(clientRoot, "design");
const tokens = readFileSync(join(designRoot, "tokens.css"), "utf8");
const roleFamilies = [
  "page-title",
  "section-title",
  "body",
  "control",
  "label",
  "metadata",
  "numeric",
] as const;

function cssPaths(root: string) {
  const paths: string[] = [];

  function visit(path: string) {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
      return;
    }
    if (path.endsWith(".css")) paths.push(path);
  }

  visit(root);
  return paths.sort();
}

function declarations(source: string) {
  return new Map(
    [...source.matchAll(/^\s*(--font-size-[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

const fontSizes = declarations(tokens);

function resolvedNumericSource(name: string, stack: string[] = []): string {
  if (stack.includes(name))
    throw new Error(`Typography token cycle: ${[...stack, name].join(" -> ")}`);
  const value = fontSizes.get(name);
  if (!value) throw new Error(`Typography token ${name} is missing`);
  const alias = value.match(/^var\((--font-size-[\w-]+)\)$/)?.[1];
  return alias ? resolvedNumericSource(alias, [...stack, name]) : value;
}

function publicOwnerPaths() {
  return ["primitives", "components", "patterns"].flatMap((root) =>
    cssPaths(join(designRoot, root)),
  );
}

describe("semantic typography roles", () => {
  it("defines used aliases for all seven role families and resolves each to the numeric scale", () => {
    const allCss = cssPaths(clientRoot)
      .filter((path) => path !== join(designRoot, "tokens.css"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const family of roleFamilies) {
      const familyRoles = [...fontSizes.keys()].filter(
        (name) => name === `--font-size-${family}` || name.startsWith(`--font-size-${family}-`),
      );
      expect(familyRoles.length, family).toBeGreaterThan(0);
      for (const role of familyRoles) {
        expect(resolvedNumericSource(role), role).toMatch(/^\d+px$/);
        expect(allCss, `${role} must have an owner`).toContain(`var(${role})`);
      }
    }
  });

  it("keeps public design-owner typography behind semantic roles", () => {
    for (const path of publicOwnerPaths()) {
      const owner = relative(designRoot, path).replaceAll("\\", "/");
      const source = readFileSync(path, "utf8");
      const directDeclarations = [
        ...source.matchAll(/^\s*(?:font-size|font)\s*:\s*[^;]*var\(--font-size-[1-8]\)[^;]*;/gm),
      ].map((match) => match[0].trim());
      expect(directDeclarations, owner).toEqual([]);
    }
  });

  it("keeps reading content and section headings at or above the compact reading tier", () => {
    for (const role of fontSizes.keys()) {
      if (!/^--font-size-(body|section-title)(-|$)/.test(role)) continue;
      expect(Number.parseFloat(resolvedNumericSource(role)), role).toBeGreaterThanOrEqual(12);
    }
  });
});
