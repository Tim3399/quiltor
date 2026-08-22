import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ConfirmDialog, IRREVERSIBLE_HOLD_MS } from "./ConfirmDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn(),
    onClose = vi.fn();
  render(
    <I18nProvider>
      <ConfirmDialog
        title="Element löschen"
        description="„Ada“ wird entfernt."
        confirmLabel="Element löschen"
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </I18nProvider>,
  );
  return { onConfirm, onClose };
}

describe("ConfirmDialog", () => {
  it("confirms a reversible action with a single click", () => {
    const { onConfirm, onClose } = open({ undoable: true });
    fireEvent.click(screen.getByRole("button", { name: "Element löschen" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names the undo shortcut only where the action can be taken back", () => {
    open({ undoable: true });
    expect(screen.getByText(/rückgängig machen/)).toBeInTheDocument();
    cleanup();
    open();
    expect(screen.queryByText(/rückgängig machen/)).toBeNull();
  });

  // The guard that matters: a hold-protected action must not fire on a click, however impatient the
  // pointer is. Only releasing after the full duration completes it.
  it("ignores a plain click on a hold-protected action", () => {
    const { onConfirm } = open({ holdDurationMs: IRREVERSIBLE_HOLD_MS });
    const button = screen.getByRole("button", { name: /gedrückt halten/ });
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("completes a hold-protected action once the duration has passed", async () => {
    vi.useFakeTimers();
    try {
      const { onConfirm } = open({ holdDurationMs: 100 });
      const button = screen.getByRole("button", { name: /gedrückt halten/ });
      // jsdom has no pointer capture; the component calls it unconditionally on pointerdown.
      (button as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture =
        () => {};
      fireEvent.pointerDown(button, { pointerId: 1 });
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces itself as an alert dialog described by its message", () => {
    open({ undoable: true });
    const dialog = screen.getByRole("alertdialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("„Ada“ wird entfernt.");
  });

  it("preselects the safe option", async () => {
    open({ undoable: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveFocus());
  });
});
