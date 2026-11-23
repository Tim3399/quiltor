import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceMapEdgeHint } from "./PlaceMapEdgeHint";
import { PlaceToolbar } from "./PlaceToolbar";

afterEach(cleanup);

describe("PlaceMapEdgeHint", () => {
  it("says the edge is reached and offers to zoom out further", () => {
    const onZoomOutFurther = vi.fn();
    render(
      <I18nProvider>
        <PlaceMapEdgeHint onZoomOutFurther={onZoomOutFurther} />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Kartenrand erreicht");
    fireEvent.click(screen.getByRole("button", { name: "Weiter herauszoomen" }));
    expect(onZoomOutFurther).toHaveBeenCalledOnce();
  });
});

describe("the view limit switch", () => {
  function renderToolbar(boundToGround: boolean, onBoundToGroundChange = vi.fn()) {
    render(
      <I18nProvider>
        <PlaceToolbar
          placesCount={1}
          selected={null}
          measuring={false}
          canUndo={false}
          canRedo={false}
          onAdd={vi.fn()}
          onAddMap={vi.fn()}
          onMeasuringToggle={vi.fn()}
          snapToGrid={false}
          onSnapToGridChange={vi.fn()}
          picturesVisible
          onPicturesVisibleChange={vi.fn()}
          boundToGround={boundToGround}
          onBoundToGroundChange={onBoundToGroundChange}
          hasGround
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
  }

  it("keeps one name and shows the state as a check", () => {
    renderToolbar(true);
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Ansicht auf die Karte begrenzen" }),
    ).toHaveAttribute("aria-checked", "true");
    cleanup();
    renderToolbar(false);
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Ansicht auf die Karte begrenzen" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("turns the limit off when it is on, and on when it is off", () => {
    const change = vi.fn();
    renderToolbar(true, change);
    fireEvent.click(screen.getByRole("menuitemcheckbox"));
    expect(change).toHaveBeenCalledWith(false);
  });
});
