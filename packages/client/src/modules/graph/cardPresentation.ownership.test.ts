import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = join(process.cwd(), "packages/client/src");

function source(path: string) {
  return readFileSync(join(clientSource, path), "utf8");
}

describe("graph card kind color ownership", () => {
  it("keeps legacy card accents out of every visual card surface", () => {
    const visualOwners = [
      "modules/story-world/StoryNodeCard.tsx",
      "modules/story-world/StoryGraph.css",
      "modules/story-world/figures/FigureCardPanel.tsx",
      "modules/story-world/figures/FigureNode.tsx",
      "modules/story-world/places/PlaceNode.tsx",
      "modules/storyboard/StoryboardNode.tsx",
      "modules/storyboard/StoryboardNode.css",
    ].map(source);

    for (const owner of visualOwners) {
      expect(owner).not.toMatch(/accent-(?:ink|gold|rose|moss)/);
      expect(owner).not.toMatch(/onPatch\(\{\s*accent/);
    }
    expect(source("modules/story-world/figures/FigureCardPanel.tsx")).not.toContain('t("accent")');
    expect(source("modules/assistant/proposals.ts")).not.toMatch(/accent:\s*["']/);
    expect(source("modules/story-world/model.ts")).toContain(
      'accent?: "ink" | "gold" | "rose" | "moss"',
    );
  });

  it("projects the shared kind contract into cards and every graph minimap", () => {
    expect(source("modules/story-world/StoryNodeCard.tsx")).toContain("cardKindClassName(kind)");
    expect(source("modules/storyboard/StoryboardNode.tsx")).toContain(
      "cardKindClassName(data.cardKind)",
    );

    const figureNode = source("modules/story-world/figures/FigureNode.tsx");
    expect(figureNode).toContain('cardKindColor(kind ?? "person")');

    const placeCanvas = source("modules/story-world/places/PlaceCanvas.tsx");
    expect(placeCanvas).toContain('cardKindColor("ort")');

    const storyboard = source("modules/storyboard/StoryboardWorkspace.tsx");
    expect(storyboard).toContain("cardKindColor(node.data.cardKind)");
    expect(storyboard).toContain("storyboardCardKind(item, allCandidates)");
  });

  it("resolves storyboard reference kinds live instead of persisting a presentation color", () => {
    const referenceIndex = source("modules/world-references/worldReferenceIndex.ts");
    const canvasModel = source("modules/storyboard/storyboardCanvasModel.ts");
    const storyboardModel = source("modules/storyboard/model.ts");

    expect(referenceIndex).toContain("cardKind");
    expect(canvasModel).toContain("resolveWorldReferenceCandidate(candidates, item.target)");
    expect(canvasModel).toContain("return liveCandidate.cardKind");
    expect(storyboardModel).not.toMatch(/(?:card|accent)Color\??:/);
  });

  it("keeps the exhaustive palette in shared owners and preserves selection stripes", () => {
    const contract = source("modules/graph/cardPresentation.ts");
    const styles = source("modules/graph/cardPresentation.css");
    const colors = source("design/colors.css");
    const kinds = [
      "person",
      "tier",
      "ort",
      "organisation",
      "objekt",
      "konzept",
      "chapter",
      "timeline",
      "note",
      "storyboard",
      "group",
      "reference",
    ];

    for (const kind of kinds) {
      expect(contract).toContain(`"${kind}"`);
      expect(styles).toContain(`.graph-card-kind--${kind}`);
      expect(colors).toContain(`--card-kind-${kind}:`);
      expect(colors).toContain(`--card-kind-${kind}-surface:`);
    }

    const storyboardCss = source("modules/storyboard/StoryboardNode.css");
    const selectedRule = storyboardCss.match(/\.storyboard-node\.is-selected\s*\{([^}]*)\}/s)?.[1];
    expect(selectedRule).toBeDefined();
    expect(selectedRule).not.toMatch(/border(?:-block-start)?-color\s*:/);
  });
});
