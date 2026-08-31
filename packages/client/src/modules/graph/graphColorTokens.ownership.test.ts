import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_KINDS, GRAPH_EDGE_COLORS } from ".";

const clientSource = join(process.cwd(), "packages/client/src");
const colorOwner = join(clientSource, "design/colors.css");

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const resolved = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(resolved) : [resolved];
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const semanticGraphColorRoles = [
  ...CARD_KINDS.flatMap((kind) => [`--card-kind-${kind}`, `--card-kind-${kind}-surface`]),
  ...GRAPH_EDGE_COLORS.filter((color) => color !== "auto").map(
    (color) => `--graph-edge-color-${color}`,
  ),
  "--graph-edge-directed-stroke",
  "--graph-edge-undirected-stroke",
];

describe("graph semantic color ownership", () => {
  it("defines every stable card and edge role in the design color owner only", () => {
    const stylesheets = filesBelow(clientSource).filter((file) => file.endsWith(".css"));

    for (const role of semanticGraphColorRoles) {
      const declaration = new RegExp(`${escapeRegExp(role)}\\s*:`);
      const owners = stylesheets.filter((file) => declaration.test(readFileSync(file, "utf8")));
      expect(owners, role).toEqual([colorOwner]);
    }
  });

  it("keeps graph color-consuming feature styles free of ad-hoc hex values", () => {
    const featureStylesheets = filesBelow(join(clientSource, "modules")).filter((file) =>
      file.endsWith(".css"),
    );
    const consumers = featureStylesheets.filter((file) =>
      /var\(--(?:card-kind-|graph-card-kind|graph-edge-|graph-relationship-edge)/.test(
        readFileSync(file, "utf8"),
      ),
    );

    expect(consumers.length).toBeGreaterThan(0);
    for (const file of consumers) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
