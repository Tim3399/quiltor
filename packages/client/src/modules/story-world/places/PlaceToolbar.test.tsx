import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceToolbar } from "./PlaceToolbar";

afterEach(cleanup);

function renderToolbar(placesCount: number, placesOnMapsCount?: number) {
  render(
    <I18nProvider>
      <PlaceToolbar
        placesCount={placesCount}
        placesOnMapsCount={placesOnMapsCount}
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
        boundToGround={false}
        onBoundToGroundChange={vi.fn()}
        hasGround={false}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("places toolbar title", () => {
  it("counts a single place in the singular", () => {
    renderToolbar(1);
    expect(screen.getByText("1 Ort")).toBeInTheDocument();
    expect(screen.queryByText("1 Orte")).toBeNull();
  });

  it("counts several places in the plural", () => {
    renderToolbar(3);
    expect(screen.getByText("3 Orte")).toBeInTheDocument();
  });

  it("names the places on opened-out maps beside the level's own count (T-379)", () => {
    renderToolbar(3, 59);
    expect(screen.getByText("3 Orte · 59 auf Karten")).toBeInTheDocument();
  });

  it("names a single place on a map in the singular", () => {
    renderToolbar(3, 1);
    expect(screen.getByText("3 Orte · 1 auf einer Karte")).toBeInTheDocument();
  });

  it("says nothing about maps when none of them holds a place", () => {
    renderToolbar(3, 0);
    expect(screen.getByText("3 Orte")).toBeInTheDocument();
    expect(screen.queryByText(/auf Karte/)).toBeNull();
  });
});
