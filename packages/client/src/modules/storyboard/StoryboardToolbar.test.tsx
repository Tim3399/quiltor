import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translateUiMessage } from "../../i18n";
import { StoryboardToolbar, type StoryboardToolbarProps } from "./StoryboardToolbar";

afterEach(cleanup);

function props(overrides: Partial<StoryboardToolbarProps> = {}): StoryboardToolbarProps {
  return {
    boards: [{ id: "main", title: "Haupthandlung" }],
    currentBoardId: "main",
    currentBoardTitle: "Haupthandlung",
    nodeCount: 2,
    libraryOpen: false,
    hasSelection: false,
    selectionLayer: null,
    canMoveForward: false,
    canMoveBackward: false,
    canUndo: false,
    canRedo: false,
    onSelectBoard: vi.fn(),
    onRenameBoard: vi.fn(),
    onAddBoard: vi.fn(),
    onAddNote: vi.fn(),
    onAddGroup: vi.fn(),
    onLibraryOpenChange: vi.fn(),
    onMoveForward: vi.fn(),
    onMoveBackward: vi.fn(),
    onDeleteSelection: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(toolbarProps: StoryboardToolbarProps) {
  return render(
    <I18nProvider>
      <StoryboardToolbar {...toolbarProps} />
    </I18nProvider>,
  );
}

/** Opens the toolbar's overflow menu and returns the named entry. */
function moreAction(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  return screen.getByRole("menuitem", { name });
}

function closeMenu() {
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
}

describe("StoryboardToolbar layer actions", () => {
  it("provides concise German and English layer labels", () => {
    expect(translateUiMessage("de", "storyboardMoveForward")).toBe("Element nach vorne");
    expect(translateUiMessage("de", "storyboardMoveBackward")).toBe("Element nach hinten");
    expect(translateUiMessage("en", "storyboardMoveForward")).toBe("Bring item forward");
    expect(translateUiMessage("en", "storyboardMoveBackward")).toBe("Send item backward");
    expect(translateUiMessage("de", "storyboardMoveFrameForward")).toBe("Rahmen nach vorne");
    expect(translateUiMessage("de", "storyboardMoveFrameBackward")).toBe("Rahmen nach hinten");
    expect(translateUiMessage("en", "storyboardMoveFrameForward")).toBe("Bring frame forward");
    expect(translateUiMessage("en", "storyboardMoveFrameBackward")).toBe("Send frame backward");
  });

  it("keeps layer actions in the overflow menu and disables them without a selection", () => {
    renderToolbar(
      props({
        canMoveForward: true,
        canMoveBackward: true,
      }),
    );

    expect(screen.queryByRole("button", { name: "Element nach vorne" })).not.toBeInTheDocument();
    for (const label of ["Element nach vorne", "Element nach hinten"]) {
      expect(moreAction(label)).toBeDisabled();
      closeMenu();
    }
  });

  it("enables only valid moves and dispatches the matching callback", () => {
    const onMoveForward = vi.fn();
    const onMoveBackward = vi.fn();
    const initialProps = props({
      hasSelection: true,
      selectionLayer: "card",
      canMoveForward: true,
      canMoveBackward: false,
      onMoveForward,
      onMoveBackward,
    });
    const { rerender } = renderToolbar(initialProps);

    expect(moreAction("Element nach hinten")).toBeDisabled();
    const forward = screen.getByRole("menuitem", { name: "Element nach vorne" });
    expect(forward).toBeEnabled();
    fireEvent.click(forward);
    expect(onMoveForward).toHaveBeenCalledOnce();
    expect(onMoveBackward).not.toHaveBeenCalled();

    rerender(
      <I18nProvider>
        <StoryboardToolbar {...initialProps} canMoveForward={false} canMoveBackward={true} />
      </I18nProvider>,
    );

    expect(moreAction("Element nach vorne")).toBeDisabled();
    const enabledBackward = screen.getByRole("menuitem", { name: "Element nach hinten" });
    expect(enabledBackward).toBeEnabled();
    fireEvent.click(enabledBackward);
    expect(onMoveBackward).toHaveBeenCalledOnce();
  });

  it("names group-layer actions after the frame and keeps a null layer disabled", () => {
    const groupProps = props({
      hasSelection: true,
      selectionLayer: "group",
      canMoveForward: true,
      canMoveBackward: true,
    });
    const { rerender } = renderToolbar(groupProps);

    expect(moreAction("Rahmen nach vorne")).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Rahmen nach hinten" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Element nach vorne" })).not.toBeInTheDocument();
    closeMenu();

    rerender(
      <I18nProvider>
        <StoryboardToolbar {...groupProps} selectionLayer={null} />
      </I18nProvider>,
    );

    expect(moreAction("Element nach vorne")).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Element nach hinten" })).toBeDisabled();
  });

  it("keeps notes, the board, the library and history in the row", () => {
    renderToolbar(props());
    const toolbar = screen.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
    for (const name of [
      "Notiz hinzufügen",
      "Elementbibliothek",
      "Rückgängig",
      "Wiederholen",
      "Weitere Aktionen",
    ]) {
      expect(within(toolbar).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });
});
