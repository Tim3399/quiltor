import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const modulesRoot = join(process.cwd(), "packages/client/src/modules");

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const resolved = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(resolved) : [resolved];
  });
}

describe("graph relationship edge presentation ownership", () => {
  it("keeps direction colors, interaction states, and labels in one shared owner", () => {
    const owner = join(modulesRoot, "graph/edgePresentation.css");
    const stylesheets = filesBelow(modulesRoot).filter((file) => file.endsWith(".css"));
    const relationshipStyleOwners = stylesheets.filter((file) =>
      /\.graph-relationship-edge(?:\b|\.)/.test(readFileSync(file, "utf8")),
    );
    const connectionPreviewOwners = stylesheets.filter((file) =>
      /\.graph-edge-surface\s+\.react-flow__connection-path/.test(readFileSync(file, "utf8")),
    );
    const css = readFileSync(owner, "utf8");
    const presentation = readFileSync(join(modulesRoot, "graph/edgePresentation.ts"), "utf8");
    const labelOwner = join(modulesRoot, "graph/GraphRelationshipEdge.css");
    const labelStyles = readFileSync(labelOwner, "utf8");
    const customLabelOwners = stylesheets.filter((file) =>
      /\.graph-edge-label(?:\b|\.)/.test(readFileSync(file, "utf8")),
    );
    const legacyBuiltinLabelOwners = stylesheets.filter((file) =>
      /\.react-flow__edge-text(?:bg|wrapper)/.test(readFileSync(file, "utf8")),
    );
    const colors = readFileSync(
      join(process.cwd(), "packages/client/src/design/colors.css"),
      "utf8",
    );

    expect(relationshipStyleOwners).toEqual([owner]);
    expect(connectionPreviewOwners).toEqual([owner]);
    expect(colors).toMatch(/--graph-edge-directed-stroke:\s*var\(--gold\);/);
    expect(colors).toMatch(/--graph-edge-undirected-stroke:\s*var\(--moss\);/);
    expect(colors).toMatch(/--graph-edge-preview-stroke:\s*var\(--focus\);/);
    for (const role of [
      "--graph-edge-color-ink",
      "--graph-edge-color-gold",
      "--graph-edge-color-rose",
      "--graph-edge-color-moss",
      "--graph-edge-color-blue",
    ]) {
      expect(colors).toContain(`${role}: var(--`);
      expect(css).toContain(`var(${role})`);
    }
    expect(css).toMatch(
      /\.react-flow__connection-path\s*\{[^}]*stroke:\s*var\(--graph-edge-preview-stroke\);/s,
    );
    expect(css).toMatch(
      /\.edge-directed\s*\{[^}]*--graph-relationship-edge-color:\s*var\(--graph-edge-directed-stroke\);/s,
    );
    expect(css).toMatch(
      /\.edge-undirected\s*\{[^}]*--graph-relationship-edge-color:\s*var\(--graph-edge-undirected-stroke\);/s,
    );
    expect(css).toMatch(
      /\.react-flow__edge\.graph-relationship-edge\s*\{[^}]*--xy-edge-stroke-selected:\s*var\(--graph-relationship-edge-color\);/s,
    );
    expect(css).toMatch(
      /:is\(\.selected,\s*:focus,\s*:focus-visible\)[^{]*\{[^}]*stroke:\s*var\(--graph-relationship-edge-color\);[^}]*stroke-width:\s*2\.5;/s,
    );
    expect(presentation).toMatch(/`edge-line-\$\{variant\}`/);
    const solidRule = css.match(
      /\.react-flow__edge\.graph-relationship-edge \.react-flow__edge-path\s*\{([^}]*)\}/s,
    )?.[1];
    expect(solidRule).toBeDefined();
    expect(solidRule).not.toContain("stroke-dasharray");
    expect(css).toMatch(
      /\.edge-line-dashed \.react-flow__edge-path\s*\{[^}]*stroke-dasharray:\s*5 4;/s,
    );
    expect(css).toMatch(
      /\.edge-line-dotted \.react-flow__edge-path\s*\{[^}]*stroke-dasharray:\s*1 5;/s,
    );
    expect(`${presentation}\n${css}`).not.toContain("edge-blood");
    expect(customLabelOwners).toEqual([labelOwner]);
    expect(legacyBuiltinLabelOwners).toEqual([]);
    expect(labelStyles).toMatch(
      /\.graph-edge-surface\s+\.react-flow__edgelabel-renderer\s*\{[^}]*z-index:\s*var\(--z-graph-edge-label\);/s,
    );
    expect(labelStyles).toMatch(/zoom-overview[^}]*\.graph-edge-label\s*\{[^}]*display:\s*none;/s);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("makes Figures and Storyboard consume the same presentation contract", () => {
    const figures = readFileSync(
      join(modulesRoot, "story-world/figures/figureCanvasModel.ts"),
      "utf8",
    );
    const storyboard = readFileSync(
      join(modulesRoot, "storyboard/storyboardCanvasModel.ts"),
      "utf8",
    );
    const figureCss = readFileSync(
      join(modulesRoot, "story-world/figures/FigureCanvas.css"),
      "utf8",
    );
    const storyboardCss = readFileSync(
      join(modulesRoot, "storyboard/StoryboardWorkspace.css"),
      "utf8",
    );
    const figureCanvas = readFileSync(
      join(modulesRoot, "story-world/figures/FigureCanvas.tsx"),
      "utf8",
    );
    const storyboardWorkspace = readFileSync(
      join(modulesRoot, "storyboard/StoryboardWorkspace.tsx"),
      "utf8",
    );

    expect(figures).toContain("graphRelationshipEdgePresentation({");
    expect(storyboard).toContain("graphRelationshipEdgePresentation({");
    expect(figureCanvas).toContain("positionGraphRelationshipEdgeLabels(nodes, edges");
    expect(figureCanvas).toContain("edgeTypes: graphRelationshipEdgeTypes");
    expect(storyboardWorkspace).toContain("positionGraphRelationshipEdgeLabels(");
    expect(storyboardWorkspace).toContain("edgeTypes={graphRelationshipEdgeTypes}");
    expect(figureCss).not.toMatch(/\.react-flow__edge(?:\.graph-relationship-edge|\.edge-line-)/);
    expect(figureCss).not.toContain("edge-blood");
    expect(storyboardCss).not.toMatch(
      /\.react-flow__edge(?:-path|-text|\.edge-(?:directed|undirected))/,
    );
  });
});
