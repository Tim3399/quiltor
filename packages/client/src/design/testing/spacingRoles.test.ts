import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { directSpacingTokenExceptions } from "./spacingExceptions";

const designRoot = join(process.cwd(), "packages/client/src/design");
const tokens = readFileSync(join(designRoot, "tokens.css"), "utf8");

const tierRoles = new Map([
  ["--spacing-optical-min", "--space-1"],
  ["--spacing-optical-tight", "--space-2"],
  ["--spacing-optical-base", "--space-3"],
  ["--spacing-optical-wide", "--space-4"],
  ["--spacing-compact-tight", "--space-6"],
  ["--spacing-compact-base", "--space-7"],
  ["--spacing-compact-wide", "--space-8"],
  ["--spacing-regular-tight", "--space-12"],
  ["--spacing-regular-base", "--space-14"],
  ["--spacing-regular-wide", "--space-16"],
  ["--spacing-section-tight", "--space-24"],
  ["--spacing-section-base", "--space-32"],
]);

// These two historical values sit between the new rhythm tiers. Keeping the complete allowlist
// here turns them into a shrinking migration budget instead of an invitation to add more drift.
const transitionRoles = new Map([
  ["--spacing-transition-control-inline-compact", "--space-9"],
  ["--spacing-transition-control-inline-base", "--space-10"],
  ["--spacing-transition-control-gap-wide", "--space-10"],
  ["--spacing-transition-container-inline-compact", "--space-10"],
  ["--spacing-transition-field-control-block", "--space-9"],
  ["--spacing-transition-field-control-inline", "--space-10"],
  ["--spacing-transition-field-choice-gap", "--space-10"],
  ["--spacing-transition-feedback-gap", "--space-10"],
  ["--spacing-transition-feedback-padding-block", "--space-10"],
]);

const spacingLayoutPropertySource =
  "(?:(?:padding|margin|inset|scroll-padding|scroll-margin)(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|(?:grid-)?(?:row-|column-)?gap|top|right|bottom|left|border-spacing)";
const spacingLayoutProperty = new RegExp(`^${spacingLayoutPropertySource}$`);
const spacingDeclaration = new RegExp(
  String.raw`^\s*(${spacingLayoutPropertySource})\s*:\s*([^;{}]+);`,
  "gm",
);

interface DirectSpacingDeclaration {
  owner: string;
  property: string;
  value: string;
  tokens: string[];
}

function declaration(name: string) {
  const match = tokens.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  return match?.[1].trim();
}

function publicOwnerPaths() {
  const roots = ["primitives", "components", "patterns"];
  const paths: string[] = [];

  function visit(path: string) {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
      return;
    }

    if (path.endsWith(".css")) {
      paths.push(relative(designRoot, path).replaceAll("\\", "/"));
    }
  }

  for (const root of roots) visit(join(designRoot, root));
  return paths.sort();
}

function normalizeDeclarationValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function directSpacingDeclarations(): DirectSpacingDeclaration[] {
  const declarations: DirectSpacingDeclaration[] = [];

  for (const owner of publicOwnerPaths()) {
    const source = readFileSync(join(designRoot, owner), "utf8");

    for (const match of source.matchAll(spacingDeclaration)) {
      const value = normalizeDeclarationValue(match[2]);
      const tokens = [...value.matchAll(/var\((--space-\d+)\)/g)].map(
        (tokenMatch) => tokenMatch[1],
      );
      if (tokens.length > 0) declarations.push({ owner, property: match[1], value, tokens });
    }
  }

  return declarations;
}

function sortedDeclarations(declarations: DirectSpacingDeclaration[]) {
  return [...declarations].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

describe("semantic spacing roles", () => {
  it("defines the four audited rhythm tiers and freezes the intermediate-role budget", () => {
    expect(declaration("--space-1")).toBe("1px");

    for (const [role, source] of tierRoles) {
      expect(declaration(role), role).toBe(`var(${source})`);
    }

    for (const [role, source] of transitionRoles) {
      expect(declaration(role), role).toBe(`var(${source})`);
    }

    const spacingRoles = [...tokens.matchAll(/^\s*(--spacing-[\w-]+):\s*([^;]+);/gm)];
    for (const [, role, value] of spacingRoles) {
      if (tierRoles.has(role) || transitionRoles.has(role)) continue;

      const referencedRole = value.trim().match(/^var\((--spacing-[\w-]+)\)$/)?.[1];
      expect(referencedRole, `${role} must resolve through a core rhythm tier`).toBeDefined();
      expect(tierRoles.has(referencedRole ?? ""), `${role} -> ${referencedRole}`).toBe(true);
    }
  });

  it("allows direct numeric layout spacing only through exact attributable exceptions", () => {
    const publicOwners = new Set(publicOwnerPaths());
    const expectedDeclarations = directSpacingTokenExceptions.map(
      ({ relationship: _relationship, reason: _reason, ...declaration }) => ({
        ...declaration,
        tokens: [...declaration.tokens],
      }),
    );

    for (const exception of directSpacingTokenExceptions) {
      expect(publicOwners.has(exception.owner), exception.owner).toBe(true);
      expect(spacingLayoutProperty.test(exception.property), exception.property).toBe(true);
      expect(exception.relationship.trim().length, exception.relationship).toBeGreaterThanOrEqual(
        12,
      );
      expect(exception.reason.trim().length, exception.relationship).toBeGreaterThanOrEqual(48);
      expect(
        [...exception.value.matchAll(/var\((--space-\d+)\)/g)].map((match) => match[1]),
        exception.relationship,
      ).toEqual(exception.tokens);
    }

    expect(new Set(expectedDeclarations.map((entry) => JSON.stringify(entry))).size).toBe(
      expectedDeclarations.length,
    );
    expect(sortedDeclarations(directSpacingDeclarations())).toEqual(
      sortedDeclarations(expectedDeclarations),
    );
  });
});
