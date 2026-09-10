import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceMapChrome, type PlaceMapChromeProps } from "./PlaceMapChrome";
import { PlaceMapToolbar } from "./PlaceMapToolbar";
import { DEFAULT_CROP, IMAGE_ZOOM_RANGE } from "./placeImageCrop";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function props(patch: Partial<PlaceMapChromeProps> = {}): PlaceMapChromeProps {
  return {
    map: { id: "weltkarte", name: "Weltkarte", type: "ort", x: 0, y: 0 },
    crop: DEFAULT_CROP,
    adjusting: false,
    layout: {
      left: 20,
      width: 760,
      headerTop: 30,
      footerTop: 440,
      imageTop: 76,
      imageHeight: 364,
      frameHeight: 452,
    },
    levelLabel: "Welt",
    placeCount: 4,
    gridVisible: true,
    zoom: 1,
    scale: { unitsPer100px: 25, unitLabel: "km" },
    onScale: vi.fn(),
    onToggleAdjusting: vi.fn(),
    onCrop: vi.fn(),
    onToggleLock: vi.fn(),
    onCollapse: vi.fn(),
    onEnter: vi.fn(),
    ...patch,
  };
}

function chrome(options: PlaceMapChromeProps) {
  return (
    <I18nProvider>
      <PlaceMapChrome {...options} />
    </I18nProvider>
  );
}

describe("expanded map chrome", () => {
  it("keeps map identity, direct place count and truthful map metadata together", () => {
    const { container } = render(chrome(props()));
    const region = screen.getByRole("region", { name: "Karte: Weltkarte" });
    expect(region).toHaveAttribute("data-map-id", "weltkarte");
    expect(within(region).getByText("Weltkarte")).toBeVisible();
    expect(within(region).getByText("Welt · 4 Orte")).toBeVisible();
    const footer = container.querySelector(".place-map-chrome__footer") as HTMLElement;
    expect(within(footer).getByText("25 km pro 100px")).toBeVisible();
    expect(within(footer).getByText("12 km")).toBeVisible();
    expect(within(footer).getByText("4")).toBeVisible();
    expect(within(footer).getByText("Welt")).toBeVisible();
    expect(within(footer).getByRole("img", { name: /Maßstabsleiste: .* km/ })).toBeVisible();
    expect(container.querySelector(".place-map-chrome__header")).toHaveStyle({ top: "30px" });
    expect(footer).toHaveStyle({ top: "440px" });
    expect(container.querySelector(".place-map-chrome__frame")).toHaveStyle({
      left: "20px",
      width: "760px",
      height: "452px",
    });
  });

  it("routes all expanded actions to their existing map callbacks", () => {
    const options = props();
    const { rerender } = render(chrome(options));
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte anpassen" }));
    expect(options.onToggleAdjusting).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte feststellen" }));
    expect(options.onToggleLock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte öffnen" }));
    expect(options.onEnter).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte einklappen" }));
    expect(options.onCollapse).toHaveBeenCalledOnce();
    rerender(chrome({ ...options, map: { ...options.map, pinned: true } }));
    fireEvent.click(screen.getByRole("button", { name: "Weltkarte lösen" }));
    expect(options.onToggleLock).toHaveBeenCalledTimes(2);
  });

  it("shows the live crop reading and preserves bounded crop controls", () => {
    const options = props({ adjusting: true });
    const { rerender } = render(chrome(options));
    expect(screen.getByText("Weltkarte")).toBeVisible();
    expect(screen.getByText("100 %")).toBeVisible();
    expect(screen.getByRole("button", { name: "Bild verkleinern" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Weltkarte feststellen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bild vergrößern" }));
    expect(options.onCrop).toHaveBeenCalledWith({ zoom: 1.15, u: 0.5, v: 0.5 });
    rerender(chrome({ ...options, crop: { ...DEFAULT_CROP, zoom: IMAGE_ZOOM_RANGE.max } }));
    expect(screen.getByText("800 %")).toBeVisible();
    expect(screen.getByRole("button", { name: "Bild vergrößern" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Bild in Weltkarte fertig anpassen" }));
    expect(options.onToggleAdjusting).toHaveBeenCalledOnce();
  });

  it("shows unscaled grid units without fabricating a physical scale bar", () => {
    const { container, rerender } = render(chrome(props({ scale: undefined, placeCount: 1 })));
    expect(screen.getByText("Welt · 1 Ort")).toBeVisible();
    expect(screen.getByText("48 px")).toBeVisible();
    expect(screen.getByText("Maßstab setzen")).toBeVisible();
    expect(container.querySelector(".place-map-chrome__scale-bar")).toBeNull();
    rerender(chrome(props({ scale: undefined, gridVisible: false })));
    expect(screen.getByText("Aus")).toBeVisible();
    expect(screen.queryByText("48 px")).toBeNull();
  });

  it("keeps long map identity and scale readings available at narrow widths", () => {
    const name = "Weltkarte mit einem sehr langen Namen";
    const unitLabel = "außerordentlich lange Entfernungseinheiten";
    const options = props({
      map: { id: "lang", name, type: "ort", x: 0, y: 0 },
      layout: {
        left: 14,
        width: 300,
        headerTop: 60,
        footerTop: 480,
        imageTop: 106,
        imageHeight: 374,
        frameHeight: 462,
      },
      scale: { unitsPer100px: 25, unitLabel },
    });
    const { container } = render(chrome(options));
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-density", "narrow");
    expect(screen.getByTitle(name)).toBeVisible();
    expect(screen.getByRole("button", { name: `Maßstab von ${name}` })).toHaveAttribute(
      "title",
      `25 ${unitLabel} pro 100px`,
    );
    expect(screen.getByRole("button", { name: `${name} einklappen` })).toBeVisible();
  });

  it("closes the scale editor when viewport projection moves its anchor", () => {
    const options = props();
    const { rerender } = render(chrome(options));
    const trigger = screen.getByRole("button", { name: "Maßstab von Weltkarte" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Maßstab von Weltkarte" })).toBeVisible();
    // A map data update at the same position must not interrupt typing.
    rerender(chrome({ ...options, scale: { unitsPer100px: 50, unitLabel: "km" } }));
    expect(screen.getByRole("dialog", { name: "Maßstab von Weltkarte" })).toBeVisible();
    rerender(chrome({ ...options, layout: { ...options.layout, footerTop: 460 } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the same horizontal edges for the header, footer and frame", () => {
    const options = props();
    const { container } = render(chrome(options));
    expect(container.querySelector(".place-map-chrome")).toHaveAttribute("data-density", "wide");
    expect(container.querySelector(".place-map-chrome__header")).toHaveStyle({ width: "760px" });
    const footer = container.querySelector(".place-map-chrome__footer");
    expect(footer).toHaveAttribute("data-density", "wide");
    expect(footer).toHaveStyle({ left: "20px", width: "760px" });
    expect(screen.getByRole("button", { name: "Maßstab von Weltkarte" })).toBeVisible();
  });

  it("preserves readable metadata by dropping the scale bar below a 500px footer", () => {
    const options = props();
    const { container, rerender } = render(
      chrome({ ...options, layout: { ...options.layout, width: 460 } }),
    );
    expect(container.querySelector(".place-map-chrome__footer")).toHaveAttribute(
      "data-density",
      "medium",
    );
    expect(screen.getByText("12 km")).toBeVisible();
    expect(container.querySelector(".place-map-chrome__scale-bar")).toBeNull();
    rerender(chrome({ ...options, layout: { ...options.layout, width: 500 } }));
    expect(screen.getByRole("img", { name: /Maßstabsleiste/ })).toBeVisible();
  });
});

describe.each(["expanded", "collapsed"] as const)("shared %s map scale editor", (mode) => {
  it("edits the authoritative scale and returns focus after Escape", () => {
    const options = props();
    render(
      <I18nProvider>
        {mode === "expanded" ? (
          <PlaceMapChrome {...options} />
        ) : (
          <PlaceMapToolbar {...options} expanded={false} measured="25 km" onExpand={vi.fn()} />
        )}
      </I18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Maßstab von Weltkarte" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const editor = screen.getByRole("dialog", { name: "Maßstab von Weltkarte" });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "Maßstab" }), {
      target: { value: "50" },
    });
    expect(options.onScale).toHaveBeenLastCalledWith({ unitsPer100px: 50 });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "Maßstab" }), {
      target: { value: "-12" },
    });
    expect(options.onScale).toHaveBeenLastCalledWith({ unitsPer100px: 0.01 });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "Maßstab" }), {
      target: { value: "" },
    });
    expect(options.onScale).toHaveBeenLastCalledWith({ unitsPer100px: 0.01 });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Einheit" }), {
      target: { value: "Meilen" },
    });
    expect(options.onScale).toHaveBeenLastCalledWith({ unitLabel: "Meilen" });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
