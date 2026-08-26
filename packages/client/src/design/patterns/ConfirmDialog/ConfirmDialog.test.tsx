import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const labels = {
  accessible: "Element löschen – halten zum Bestätigen",
  idle: "Element löschen · halten",
  active: "Weiter halten",
};

function renderClickDialog() {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Element löschen?"
      description="Das Element wird entfernt."
      supportingText="Die Änderung kann rückgängig gemacht werden."
      closeLabel="Dialog schließen"
      cancelLabel="Zurück"
      confirmLabel="Element löschen"
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

describe("ConfirmDialog", () => {
  it("renders entirely from caller-owned copy and completes a click confirmation", () => {
    const { onConfirm, onClose } = renderClickDialog();
    const dialog = screen.getByRole("alertdialog", { name: "Element löschen?" });
    expect(dialog).toHaveAccessibleDescription(
      "Das Element wird entfernt. Die Änderung kann rückgängig gemacht werden.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Element löschen" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preselects the caller-labelled safe option", async () => {
    renderClickDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Zurück" })).toHaveFocus());
  });

  it("does not treat a click as a completed hold confirmation", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        confirmation="hold"
        holdDurationMs={100}
        holdLabels={labels}
        title="Element löschen?"
        description="Das Element wird entfernt."
        closeLabel="Dialog schließen"
        cancelLabel="Zurück"
        confirmLabel="Element löschen"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: labels.accessible }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("completes a continuous pointer hold exactly once", async () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      const onClose = vi.fn();
      render(
        <ConfirmDialog
          confirmation="hold"
          holdDurationMs={100}
          holdLabels={labels}
          title="Element löschen?"
          description="Das Element wird entfernt."
          closeLabel="Dialog schließen"
          cancelLabel="Zurück"
          confirmLabel="Element löschen"
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      );
      const button = screen.getByRole("button", { name: labels.accessible });
      fireEvent.pointerDown(button, { pointerId: 1 });
      expect(button).toHaveTextContent(labels.active);
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a hold that ends before the threshold", async () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      render(
        <ConfirmDialog
          confirmation="hold"
          holdDurationMs={200}
          holdLabels={labels}
          title="Element löschen?"
          description="Das Element wird entfernt."
          closeLabel="Dialog schließen"
          cancelLabel="Zurück"
          confirmLabel="Element löschen"
          onConfirm={onConfirm}
          onClose={() => undefined}
        />,
      );
      const button = screen.getByRole("button", { name: labels.accessible });
      fireEvent.pointerDown(button, { pointerId: 1 });
      await vi.advanceTimersByTimeAsync(80);
      fireEvent.pointerUp(button, { pointerId: 1 });
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(button).toHaveTextContent(labels.idle);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts a destructive hold from a non-primary pointer button", async () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      render(
        <ConfirmDialog
          confirmation="hold"
          holdDurationMs={100}
          holdLabels={labels}
          title="Element löschen?"
          description="Das Element wird entfernt."
          closeLabel="Dialog schließen"
          cancelLabel="Zurück"
          confirmLabel="Element löschen"
          onConfirm={onConfirm}
          onClose={() => undefined}
        />,
      );
      const button = screen.getByRole("button", { name: labels.accessible });
      fireEvent.pointerDown(button, { button: 2, pointerId: 1 });
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(button).toHaveTextContent(labels.idle);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports a continuous keyboard hold", async () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      render(
        <ConfirmDialog
          confirmation="hold"
          holdDurationMs={100}
          holdLabels={labels}
          title="Element löschen?"
          description="Das Element wird entfernt."
          closeLabel="Dialog schließen"
          cancelLabel="Zurück"
          confirmLabel="Element löschen"
          onConfirm={onConfirm}
          onClose={() => undefined}
        />,
      );
      const button = screen.getByRole("button", { name: labels.accessible });
      fireEvent.keyDown(button, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).toHaveBeenCalledOnce();
      fireEvent.keyUp(button, { key: "Enter" });
      fireEvent.keyDown(button, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(200);
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
