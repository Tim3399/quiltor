import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import {
  type PlaceFlowNode,
  PlaceNode,
  placeCompactLayoutHeight,
  placeCompactLayoutWidth,
} from "./PlaceNode";

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
    expect(screen.getByText("D", { selector: ".place-node-monogram" })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("uses a circular monogram for regular and important places at final LOD", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceNode.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.story-node\.zoom-overview\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--minimap-place\);/s,
    );
    expect(css).toMatch(
      /\.story-node\.zoom-overview \.place-node-monogram\s*\{[^}]*display:\s*grid;/s,
    );
    expect(css).toMatch(
      /\.story-node\.zoom-overview\.is-important\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*border:\s*2px solid var\(--gold\);[^}]*border-radius:\s*50%;/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\)[\s\S]*?\.story-node\.zoom-overview\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\)[\s\S]*?\.story-node\.zoom-overview\.is-important\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    );
    expect(css).toMatch(
      /\.story-node\.zoom-overview :is\(\.node-kind, strong, small\)\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("keeps overview state emphasis in interaction priority order", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/story-world/places/PlaceNode.css"),
      "utf8",
    );
    const important = css.indexOf(".story-node.zoom-overview.is-important");
    const selected = css.indexOf(".story-node.zoom-overview.selected");
    const measuring = css.indexOf(".story-node.type-ort.is-measuring");
    const measureStart = css.indexOf(".story-node.type-ort.is-measure-start");

    expect(important).toBeGreaterThan(-1);
    expect(selected).toBeGreaterThan(important);
    expect(measuring).toBeGreaterThan(selected);
    expect(measureStart).toBeGreaterThan(measuring);
  });

  it("keeps an important overview place on the same monogram markup", () => {
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
    expect(screen.getByText("D", { selector: ".place-node-monogram" })).toBeInTheDocument();
    expect(screen.getByText("Dämmerhafen", { selector: "strong" })).toBeInTheDocument();
  });

  it("counter-scales compact layout height to a real 44px mobile hit target", () => {
    const viewportZoom = 0.42;
    const regularLayoutHeight = placeCompactLayoutHeight(viewportZoom, 32.5);
    const touchLayoutHeight = placeCompactLayoutHeight(viewportZoom, 44.5);
    const compactLayoutWidth = placeCompactLayoutWidth(viewportZoom, 96.5);

    expect(regularLayoutHeight * viewportZoom).toBeGreaterThanOrEqual(32);
    expect(touchLayoutHeight * viewportZoom).toBeGreaterThanOrEqual(44);
    expect(compactLayoutWidth * viewportZoom).toBeGreaterThanOrEqual(96);
    expect(placeCompactLayoutHeight(0.8, 44.5)).toBe(68);
  });
});
