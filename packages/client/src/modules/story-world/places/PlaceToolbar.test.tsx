import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceToolbar } from "./PlaceToolbar";

afterEach(cleanup);

function renderToolbar(placesCount: number) {
  render(
    <I18nProvider>
      <PlaceToolbar
        placesCount={placesCount}
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
});
