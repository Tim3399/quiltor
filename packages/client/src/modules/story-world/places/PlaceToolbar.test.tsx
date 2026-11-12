import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PlaceToolbar } from "./PlaceToolbar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubCompactToolbar(compact: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: compact && query === "(max-width: 719px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

type Overrides = {
  selected?: boolean;
  picturesVisible?: boolean;
  hasGround?: boolean;
  boundToGround?: boolean;
};

function renderToolbar(placesCount: number, overrides: Overrides = {}) {
  const props = {
    onPicturesVisibleChange: vi.fn(),
    onBoundToGroundChange: vi.fn(),
    onSnapToGridChange: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <I18nProvider>
      <PlaceToolbar
        placesCount={placesCount}
        selected={
          overrides.selected ? { id: "hafen", name: "Hafen", type: "ort", x: 0, y: 0 } : null
        }
        measuring={false}
        canUndo={false}
        canRedo={false}
        onAdd={vi.fn()}
        onAddMap={vi.fn()}
        onMeasuringToggle={vi.fn()}
        snapToGrid={false}
        onSnapToGridChange={props.onSnapToGridChange}
        picturesVisible={overrides.picturesVisible ?? true}
        onPicturesVisibleChange={props.onPicturesVisibleChange}
        boundToGround={overrides.boundToGround ?? false}
        onBoundToGroundChange={props.onBoundToGroundChange}
        hasGround={overrides.hasGround ?? false}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
      />
    </I18nProvider>,
  );
  return props;
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

describe("places toolbar row", () => {
  it("shows map pictures as a pressed toggle in the row, without a view menu", () => {
    stubCompactToolbar(false);
    const props = renderToolbar(2, { picturesVisible: true });
    expect(screen.queryByRole("button", { name: "Ansicht" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ortsaktionen" })).toBeNull();
    const pictures = screen.getByRole("button", { name: "Kartenbilder" });
    expect(pictures).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pictures);
    expect(props.onPicturesVisibleChange).toHaveBeenCalledWith(false);
  });

  it("keeps grid and map binding as settings in the one overflow menu", () => {
    stubCompactToolbar(false);
    const props = renderToolbar(2, { hasGround: true, boundToGround: true });
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });
    expect(within(menu).queryByRole("menuitemcheckbox", { name: "Kartenbilder" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Am Raster ausrichten" }));
    expect(props.onSnapToGridChange).toHaveBeenCalledWith(true);
    const binding = within(menu).getByRole("menuitemcheckbox", { name: "An die Karte binden" });
    expect(binding).toHaveAttribute("aria-checked", "true");
    fireEvent.click(binding);
    expect(props.onBoundToGroundChange).toHaveBeenCalledWith(false);
  });

  it("disables binding without a map and place actions without a selection", () => {
    stubCompactToolbar(false);
    renderToolbar(2, { hasGround: false, selected: false });
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "An die Karte binden" }),
    ).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Ort duplizieren" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Ort löschen" })).toBeDisabled();
  });

  it("offers the place actions of a selected place in the overflow menu", () => {
    stubCompactToolbar(false);
    const props = renderToolbar(2, { selected: true });
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ort duplizieren" }));
    expect(props.onDuplicate).toHaveBeenCalledOnce();
  });

  it("moves map pictures into the overflow menu on a compact row and keeps undo in the row", () => {
    stubCompactToolbar(true);
    renderToolbar(2, { picturesVisible: false });
    expect(screen.queryByRole("button", { name: "Kartenbilder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const menu = screen.getByRole("menu", { name: "Weitere Aktionen" });
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Kartenbilder" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(menu).queryByRole("menuitem", { name: "Rückgängig" })).toBeNull();
  });
});
