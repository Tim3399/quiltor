import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { storyNodeCompactLayoutHeight, storyNodeCompactLayoutWidth } from "../StoryNodeCard";
import { type PlaceFlowNode, PlaceNode } from "./PlaceNode";

vi.mock("@xyflow/react", () => ({
  Handle: () => <span data-testid="place-handle" />,
  Position: { Bottom: "bottom", Top: "top" },
}));

afterEach(cleanup);

describe("PlaceNode overview marker", () => {
  it("keeps the place name accessible while exposing a visual monogram", () => {
    const props = {
      selected: false,
      data: {
        place: { id: "harbor", x: 0, y: 0, name: "Dämmerhafen", type: "ort" },
        measuring: false,
        measureStart: false,
        zoomTier: "overview",
        zoom: 0.2,
      },
    } as NodeProps<PlaceFlowNode>;

    const { container } = render(
      <I18nProvider>
        <PlaceNode {...props} />
      </I18nProvider>,
    );

    expect(container.querySelector(".story-node.zoom-overview")).toBeInTheDocument();
    expect(screen.getByText("Dämmerhafen")).toBeInTheDocument();
    expect(screen.getByText("D", { selector: ".node-monogram" })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("uses the shared figure/place LOD contract instead of local place geometry", () => {
    const sharedCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/StoryGraph.css"),
      "utf8",
    );
    const placeCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceNode.css"),
      "utf8",
    );

    expect(sharedCss).toMatch(
      /\.story-node\.zoom-overview:not\(\.is-important\)\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*border-radius:\s*50%;/s,
    );
    expect(sharedCss).toMatch(
      /\.story-node\.zoom-overview \.node-monogram\s*\{[^}]*display:\s*grid;/s,
    );
    expect(sharedCss).toMatch(
      /\.story-node\.zoom-overview\.is-important\s*\{[^}]*width:\s*116px;[^}]*height:\s*34px;/s,
    );
    expect(sharedCss).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\)[\s\S]*?\.story-node\.zoom-overview:not\(\.is-important\)\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    );
    expect(placeCss).not.toMatch(/zoom-(?:compact|overview)/);
  });

  it("keeps place-only measurement emphasis in interaction priority order", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceNode.css"),
      "utf8",
    );
    const measuring = css.indexOf(".story-node.type-ort.is-measuring");
    const measureStart = css.indexOf(".story-node.type-ort.is-measure-start");

    expect(measuring).toBeGreaterThan(-1);
    expect(measureStart).toBeGreaterThan(measuring);
  });

  it("keeps the shared identity markup while important overview places use the label pill", () => {
    const props = {
      selected: false,
      data: {
        place: {
          id: "harbor",
          x: 0,
          y: 0,
          name: "Dämmerhafen",
          type: "ort",
          important: true,
        },
        measuring: false,
        measureStart: false,
        zoomTier: "overview",
        zoom: 0.08,
      },
    } as NodeProps<PlaceFlowNode>;

    const { container } = render(
      <I18nProvider>
        <PlaceNode {...props} />
      </I18nProvider>,
    );

    expect(container.querySelector(".story-node.zoom-overview.is-important")).toBeInTheDocument();
    expect(screen.getByText("D", { selector: ".node-monogram" })).toBeInTheDocument();
    expect(screen.getByText("Dämmerhafen", { selector: "strong" })).toBeInTheDocument();
  });

  it("counter-scales compact layout height to a real 44px mobile hit target", () => {
    const viewportZoom = 0.42;
    const regularLayoutHeight = storyNodeCompactLayoutHeight(viewportZoom, 32.5);
    const touchLayoutHeight = storyNodeCompactLayoutHeight(viewportZoom, 45);
    const compactLayoutWidth = storyNodeCompactLayoutWidth(viewportZoom, 98);

    expect(regularLayoutHeight * viewportZoom).toBeGreaterThanOrEqual(32);
    expect(touchLayoutHeight * viewportZoom).toBeGreaterThanOrEqual(44);
    expect(compactLayoutWidth * viewportZoom).toBeGreaterThanOrEqual(96);
    expect(storyNodeCompactLayoutHeight(0.8, 44.5)).toBe(68);
  });
});
