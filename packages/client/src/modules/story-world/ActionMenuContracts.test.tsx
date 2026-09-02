import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../i18n";
import { PlaceToolbar } from "./places/PlaceToolbar";
import { MomentHeader } from "./timeline/MomentHeader";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openMenu(triggerName: string, key: "ArrowDown" | "ArrowUp" = "ArrowDown") {
  const trigger = screen.getByRole("button", { name: triggerName });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  trigger.focus();
  fireEvent.keyDown(trigger, { key });

  const menu = await screen.findByRole("menu");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", menu.id);
  return { menu, trigger };
}

function TimelineMenuFixture() {
  const { t } = useI18n();
  return (
    <MomentHeader
      moment={{ id: "m1", title: "Ankunft" }}
      index={1}
      total={3}
      changeCount={0}
      onSelectPrevious={vi.fn()}
      onSelectNext={vi.fn()}
      onMoveEarlier={vi.fn()}
      onMoveLater={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      chapterReferences={[]}
      rangeConflict={null}
      t={t}
    />
  );
}

describe("story-world action menu contracts", () => {
  it("keeps place actions in a compact sheet and separates the dangerous action", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <I18nProvider>
        <PlaceToolbar
          placesCount={1}
          selected={{ id: "p1", name: "Hafen", type: "ort", x: 0, y: 0 }}
          measuring={false}
          canUndo={false}
          canRedo={false}
          onAdd={vi.fn()}
          onAddMap={vi.fn()}
          onMeasuringToggle={vi.fn()}
          snapToGrid
          onSnapToGridChange={vi.fn()}
          picturesVisible
          onPicturesVisibleChange={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );

    const { menu, trigger } = await openMenu("Ortsaktionen");
    expect(screen.getByRole("dialog", { name: "Ortsaktionen" })).toHaveClass("ui-sheet");
    expect(within(menu).getByRole("separator")).toBeVisible();
    const deleteItem = within(menu).getByRole("menuitem", { name: "Ort löschen" });
    expect(deleteItem).toHaveAttribute("data-tone", "danger");
    expect(deleteItem.querySelector(".ui-menu__label")).toHaveTextContent("Ort löschen");

    fireEvent.keyDown(deleteItem, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens moment actions with ArrowUp and restores focus after an outside click", async () => {
    render(
      <I18nProvider>
        <TimelineMenuFixture />
      </I18nProvider>,
    );

    const { menu, trigger } = await openMenu("Aktionen", "ArrowUp");
    expect(within(menu).getByRole("separator")).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Löschen" })).toHaveAttribute(
      "data-tone",
      "danger",
    );

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
