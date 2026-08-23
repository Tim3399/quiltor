import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { BackupDialog } from "./BackupDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog({
  flush = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
}: {
  flush?: () => Promise<void>;
  onClose?: () => void;
} = {}) {
  return {
    flush,
    onClose,
    ...render(
      <I18nProvider>
        <BackupDialog flush={flush} onClose={onClose} />
      </I18nProvider>,
    ),
  };
}

describe("BackupDialog", () => {
  it("flushes before loading, selects a backup and opens the restore confirmation", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
    });
    vi.spyOn(quiltorClient.application.backup, "list").mockImplementation(async () => {
      order.push("list");
      return {
        ok: true,
        backups: [{ name: "snapshot-1", created: "2026-08-23T08:30:00Z", size: 2048 }],
      };
    });
    const restore = vi.spyOn(quiltorClient.application.backup, "restore");

    renderDialog({ flush });

    const list = screen.getByRole("navigation", { name: "Sicherungen" });
    const backup = await within(list).findByRole("button", { name: /2 KB/ });
    expect(order).toEqual(["flush", "list"]);
    expect(backup).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(backup);
    expect(backup).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));

    expect(screen.getByRole("alertdialog", { name: "Sicherung wiederherstellen" })).toBeVisible();
    expect(restore).not.toHaveBeenCalled();
  });

  it("keeps the close action accessible and delegates it to the sheet owner", () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({
      ok: true,
      backups: [],
    });
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders asynchronous list failures through the established alert", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockRejectedValue(new Error("offline"));

    renderDialog();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
  });
});
