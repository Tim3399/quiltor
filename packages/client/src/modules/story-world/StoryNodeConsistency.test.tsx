import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { type FigureFlowNode, StoryNode } from "./figures/FigureNode";
import { type PlaceFlowNode, PlaceNode } from "./places/PlaceNode";

vi.mock("@xyflow/react", () => ({
  Handle: ({ className = "", id = "" }: { className?: string; id?: string }) => (
    <span className={className} data-handle-id={id} />
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
}));

afterEach(cleanup);

function renderFigureNode() {
  const props = {
    selected: false,
    data: {
      figure: { id: "figure", x: 0, y: 0, name: "Ada", type: "person", sub: "Archivarin" },
      deceased: false,
      guests: [],
      zoomTier: "compact",
      zoom: 0.4,
    },
  } as unknown as NodeProps<FigureFlowNode>;

  return render(
    <I18nProvider>
      <StoryNode {...props} />
    </I18nProvider>,
  ).container;
}

function renderPlaceNode() {
  const props = {
    selected: false,
    data: {
      place: { id: "place", x: 0, y: 0, name: "Auenhafen", type: "ort", sub: "Nordküste" },
      measuring: false,
      measureStart: false,
      zoomTier: "compact",
      zoom: 0.4,
    },
  } as unknown as NodeProps<PlaceFlowNode>;

  return render(
    <I18nProvider>
      <PlaceNode {...props} />
    </I18nProvider>,
  ).container;
}

function nodeIdentityShape(node: Element) {
  return [".node-kind", ".node-monogram", "strong", "small"].map((selector) => {
    const element = node.querySelector(selector);
    return {
      selector,
      tag: element?.tagName,
      directChild: element?.parentElement === node,
      hidden: element?.getAttribute("aria-hidden"),
    };
  });
}

function lodGeometryOverrides(css: string) {
  const geometry =
    /(?:^|;)\s*(?:width|height|min-width|min-height|max-width|max-height|padding(?:-[\w-]+)?|transform(?:-origin)?|display|place-items|font(?:-size)?)\s*:/m;

  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).flatMap((match) => {
    const selector = match[1].trim();
    const declarations = match[2];
    const ownsNodeGeometry = selector.split(",").some((part) => {
      const lod = part.match(/\.story-node\.zoom-(?:compact|overview)/);
      if (!lod || lod.index === undefined) return false;
      const suffix = part.slice(lod.index + lod[0].length);
      return !/\s\S/.test(suffix);
    });
    return ownsNodeGeometry && geometry.test(declarations) ? [selector] : [];
  });
}

describe("story-node cross-workspace consistency", () => {
  it("renders places and figures through the same identity and LOD geometry contract", () => {
    const figureContainer = renderFigureNode();
    const placeContainer = renderPlaceNode();
    const figureNode = figureContainer.querySelector<HTMLElement>(".story-node");
    const placeNode = placeContainer.querySelector<HTMLElement>(".story-node");

    expect(figureNode).not.toBeNull();
    expect(placeNode).not.toBeNull();
    if (!figureNode || !placeNode) return;

    expect(nodeIdentityShape(figureNode)).toEqual(nodeIdentityShape(placeNode));
    expect(figureNode.querySelector(".node-monogram")).toHaveTextContent("A");
    expect(placeNode.querySelector(".node-monogram")).toHaveTextContent("A");

    expect(figureNode.style.cssText).not.toBe("");
    expect(placeNode.style.cssText).toBe(figureNode.style.cssText);
  });

  it("keeps shared LOD geometry out of feature-owned stylesheets", () => {
    const root = join(process.cwd(), "packages/client/src/modules/story-world");
    const sharedCss = readFileSync(join(root, "StoryGraph.css"), "utf8");
    const featureCss = [
      readFileSync(join(root, "figures/FigureCanvas.css"), "utf8"),
      readFileSync(join(root, "places/PlaceNode.css"), "utf8"),
    ];

    expect(lodGeometryOverrides(sharedCss).length).toBeGreaterThan(0);
    expect(sharedCss).toMatch(/\.story-node\.zoom-overview[^{]* \.node-monogram/);
    for (const css of featureCss) {
      expect(lodGeometryOverrides(css)).toEqual([]);
      expect(css).not.toContain("place-node-monogram");
    }
  });
});
