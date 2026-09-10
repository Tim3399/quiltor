import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { storyNodeCompactLayoutHeight, storyNodeCompactLayoutWidth } from "../StoryNodeCard";
import {
  PlaceMapFrameProvider,
  type PlaceMapVisualClip,
  usePlaceMapVisualClipPublisher,
} from "./PlaceMapFrameContext";
import { type PlaceFlowNode, PlaceNode, placeNodeVisualClip } from "./PlaceNode";

vi.mock("@xyflow/react", () => ({
  Handle: ({ className }: { className?: string }) => (
    <span className={className} data-testid="place-handle" />
  ),
  Position: { Bottom: "bottom", Top: "top" },
}));

afterEach(cleanup);

function VisualClipPublisher({ clip }: { clip: PlaceMapVisualClip }) {
  const publish = usePlaceMapVisualClipPublisher();
  useLayoutEffect(() => {
    publish(clip);
    return () => publish(undefined);
  }, [clip, publish]);
  return null;
}

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
    expect(placeCss).not.toMatch(/\.place-node-shell\s+\.story-node\.zoom-(?:compact|overview)/);
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

describe("PlaceNode display modes", () => {
  const data = {
    place: { id: "harbor", x: 0, y: 0, name: "Dämmerhafen", type: "ort" as const },
    measuring: false,
    measureStart: false,
    filled: false,
    onOpenLevel: vi.fn(),
    onExpandMap: vi.fn(),
    onPlaceDisplayChange: vi.fn(),
    zoomTier: "detail" as const,
    zoom: 1,
    pin: false,
  };
  const props = (nextData: PlaceFlowNode["data"], selected = false): NodeProps<PlaceFlowNode> => ({
    id: "harbor",
    data: nextData,
    type: "place",
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected,
    draggable: true,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  });

  it("offers a named card-to-pin action without selecting the place", () => {
    const onPlaceDisplayChange = vi.fn();
    render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, onPlaceDisplayChange })} />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ort Dämmerhafen als Stecknadel anzeigen" }),
    );
    expect(onPlaceDisplayChange).toHaveBeenCalledWith(data.place, "pin");
  });

  it("renders the persistent pin target and offers the inverse action", () => {
    const onPlaceDisplayChange = vi.fn();
    const { container } = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true, onPlaceDisplayChange }, true)} />
      </I18nProvider>,
    );

    expect(container.querySelector(".place-node-pin__tip")).toBeInTheDocument();
    expect(container.querySelectorAll(".place-node-pin__handle")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Ort Dämmerhafen als Karte anzeigen" }));
    expect(onPlaceDisplayChange).toHaveBeenCalledWith(data.place, "card");
  });

  it("reduces persistent pin content across semantic zoom tiers", () => {
    const detail = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true })} />
      </I18nProvider>,
    );
    expect(detail.container.querySelector('[data-zoom-tier="detail"]')).toBeInTheDocument();
    expect(detail.container.querySelectorAll(".place-node-pin__action")).toHaveLength(2);
    detail.unmount();

    const compact = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true, zoomTier: "compact" })} />
      </I18nProvider>,
    );
    expect(compact.container.querySelector('[data-zoom-tier="compact"]')).toBeInTheDocument();
    expect(compact.container.querySelectorAll(".place-node-pin__action")).toHaveLength(1);
    compact.unmount();

    const overview = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true, zoomTier: "overview" })} />
      </I18nProvider>,
    );
    expect(overview.container.querySelector('[data-zoom-tier="overview"]')).toBeInTheDocument();
    expect(
      screen.getByText("Dämmerhafen", { selector: ".place-node-pin__name" }),
    ).toBeInTheDocument();
    expect(overview.container.querySelectorAll(".place-node-pin__action")).toHaveLength(0);
  });

  it("hides a persistent pin while its precise drag preview is active", () => {
    const { container } = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true, dragPreview: true })} />
      </I18nProvider>,
    );

    expect(container.querySelector(".place-node-pin")).toHaveAttribute("data-drag-preview", "true");
  });

  it("animates a rendered display change without animating initial placement", async () => {
    const rendered = render(
      <I18nProvider>
        <PlaceNode {...props(data)} />
      </I18nProvider>,
    );

    expect(rendered.container.querySelector(".place-node-shell")).not.toHaveClass(
      "is-display-transition",
    );
    rendered.rerender(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true })} />
      </I18nProvider>,
    );
    const pin = rendered.container.querySelector(".place-node-pin");
    await waitFor(() => expect(pin).toHaveClass("is-display-transition"));
  });

  it("moves keyboard focus to the inverse action after each rendered mode change", async () => {
    const onPlaceDisplayChange = vi.fn();
    const rendered = render(
      <I18nProvider>
        <PlaceNode {...props({ ...data, onPlaceDisplayChange })} />
      </I18nProvider>,
    );

    const showPin = screen.getByRole("button", {
      name: "Ort Dämmerhafen als Stecknadel anzeigen",
    });
    showPin.focus();
    fireEvent.click(showPin);
    rendered.rerender(
      <I18nProvider>
        <PlaceNode {...props({ ...data, pin: true, onPlaceDisplayChange })} />
      </I18nProvider>,
    );
    const showCard = screen.getByRole("button", { name: "Ort Dämmerhafen als Karte anzeigen" });
    await waitFor(() => expect(showCard).toHaveFocus());

    fireEvent.click(showCard);
    const nativeFocus = HTMLElement.prototype.focus;
    let focusAttempts = 0;
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      focusAttempts += 1;
      if (focusAttempts > 1) nativeFocus.call(this, options);
    });
    rendered.rerender(
      <I18nProvider>
        <PlaceNode {...props({ ...data, onPlaceDisplayChange })} />
      </I18nProvider>,
    );
    await waitFor(() => expect(focusAttempts).toBe(1));
    rendered.rerender(
      <I18nProvider>
        <PlaceNode {...props({ ...data, onPlaceDisplayChange })} width={200} height={96} />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Ort Dämmerhafen als Stecknadel anzeigen" }),
      ).toHaveFocus(),
    );
    focus.mockRestore();
  });
});

describe("PlaceNode host-map clipping", () => {
  it("computes partial, outside and expanded clip rectangles in node coordinates", () => {
    const visibleMap = { x: 0, y: 0, width: 100, height: 100 };
    expect(placeNodeVisualClip(visibleMap, { x: -10, y: 20, width: 30, height: 40 })).toEqual({
      clipPath: "inset(-20px -80px -40px 10px)",
    });
    expect(placeNodeVisualClip(visibleMap, { x: -50, y: 20, width: 20, height: 20 })).toEqual({
      clipPath: "inset(-20px -130px -60px 50px)",
    });
    expect(placeNodeVisualClip(visibleMap, { x: 10, y: 10, width: 20, height: 20 })).toEqual({
      clipPath: "inset(-10px -70px -70px -10px)",
    });
    expect(placeNodeVisualClip(undefined, { x: 0, y: 0, width: 20, height: 20 })).toBeUndefined();
  });

  it("clips only a child of the published host map", () => {
    const clip = {
      mapId: "host",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const baseData = {
      place: {
        id: "harbor",
        x: 0,
        y: 0,
        name: "Dämmerhafen",
        type: "ort" as const,
        parentPlaceId: "host",
      },
      measuring: false,
      measureStart: false,
      filled: false,
      onOpenLevel: vi.fn(),
      onExpandMap: vi.fn(),
      onPlaceDisplayChange: vi.fn(),
      zoomTier: "detail" as const,
      zoom: 1,
      pin: true,
    };
    const nodeProps = {
      id: "harbor",
      data: baseData,
      selected: false,
      positionAbsoluteX: -10,
      positionAbsoluteY: 20,
      width: 30,
      height: 40,
    } as unknown as NodeProps<PlaceFlowNode>;
    const rendered = render(
      <I18nProvider>
        <PlaceMapFrameProvider>
          <VisualClipPublisher clip={clip} />
          <PlaceNode {...nodeProps} />
        </PlaceMapFrameProvider>
      </I18nProvider>,
    );
    expect(rendered.container.querySelector(".place-node-pin")).toHaveAttribute(
      "data-map-clipped",
      "true",
    );
    expect(rendered.container.querySelector(".place-node-pin")).toHaveStyle({
      clipPath: "inset(-20px -80px -40px 10px)",
    });

    rendered.rerender(
      <I18nProvider>
        <PlaceMapFrameProvider>
          <VisualClipPublisher clip={clip} />
          <PlaceNode {...nodeProps} data={{ ...baseData, dragPreview: true }} />
        </PlaceMapFrameProvider>
      </I18nProvider>,
    );
    expect(rendered.container.querySelector(".place-node-pin")).not.toHaveAttribute(
      "data-map-clipped",
    );
    expect(
      (rendered.container.querySelector(".place-node-pin") as HTMLElement).style.clipPath,
    ).toBe("");

    rendered.rerender(
      <I18nProvider>
        <PlaceMapFrameProvider>
          <VisualClipPublisher clip={clip} />
          <PlaceNode {...nodeProps} data={{ ...baseData, pin: false }} />
        </PlaceMapFrameProvider>
      </I18nProvider>,
    );
    expect(rendered.container.querySelector(".place-node-shell")).toHaveStyle({
      clipPath: "inset(-20px -80px -40px 10px)",
    });

    rendered.rerender(
      <I18nProvider>
        <PlaceMapFrameProvider>
          <VisualClipPublisher clip={clip} />
          <PlaceNode
            {...nodeProps}
            data={{ ...baseData, place: { ...baseData.place, parentPlaceId: "other" } }}
          />
        </PlaceMapFrameProvider>
      </I18nProvider>,
    );
    expect(
      (rendered.container.querySelector(".place-node-pin") as HTMLElement).style.clipPath,
    ).toBe("");
  });
});
