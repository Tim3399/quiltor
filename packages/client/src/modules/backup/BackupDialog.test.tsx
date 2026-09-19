import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { BackupDialog } from "./BackupDialog";
import type { BackupPreviewDocuments } from "./model";

const backups = [
  { name: "snapshot-1", created: "2026-08-23T08:30:00Z", size: 2048 },
  { name: "snapshot-2", created: "2026-08-24T09:00:00Z", size: 4096 },
];

const previewDocuments = (title: string): BackupPreviewDocuments => ({
  manuscript: {
    chapters: [
      { id: "c1", title, body: "Der echte Text aus der Sicherung.", note: "" },
      { id: "c2", title: "Alternative", body: "Nicht im Buch.", note: "", inBook: false },
    ],
    trash: [
      {
        chapter: { id: "deleted", title: "Gelöscht", body: "", note: "" },
        deletedAt: "2026-08-20T08:00:00.000Z",
        originalFolderPath: [],
        treeItem: { id: "tree-deleted", kind: "chapter", chapterId: "deleted", position: 0 },
      },
    ],
  },
  figures: { nodes: [{ id: "mara", x: 0, y: 0, name: "Mara" }], edges: [] },
  storyboards: { boards: [{ id: "board", title: "Akt Eins" }], nodes: [], edges: [] },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(quiltorClient.application.backup, "location").mockResolvedValue({
    ok: true,
    storage: {
      databasePath: "C:\\Quiltor\\world.sqlite3",
      backupDirectory: "C:\\Quiltor\\backups",
      lastSuccessfulBackup: "2026-08-24T09:00:00Z",
      scope: "application-host",
      canOpenFolder: false,
    },
  });
  vi.spyOn(quiltorClient.platform.clipboard, "writeText").mockResolvedValue(undefined);
});

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
  it("shows a failed initial flush without reading backup state", async () => {
    const list = vi.spyOn(quiltorClient.application.backup, "list");
    renderDialog({ flush: vi.fn().mockRejectedValue(new Error("Draft could not be saved")) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft could not be saved");
    expect(list).not.toHaveBeenCalled();
    expect(quiltorClient.application.backup.location).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Sicherung wiederherstellen" }),
    ).not.toBeInTheDocument();
  });

  it("shows host storage paths, copies the path, and offers no fake folder action", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({ ok: true, backups: [] });
    renderDialog();

    expect(await screen.findByText("C:\\Quiltor\\world.sqlite3")).toBeVisible();
    expect(screen.getByText("C:\\Quiltor\\backups")).toBeVisible();
    expect(screen.getByText(/bei Webhosting auf dem Server/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pfad kopieren" }));
    await waitFor(() =>
      expect(quiltorClient.platform.clipboard.writeText).toHaveBeenCalledWith(
        "C:\\Quiltor\\backups",
      ),
    );
    expect(screen.queryByRole("button", { name: /Ordner.*öffnen/i })).not.toBeInTheDocument();
  });

  it("flushes before preview and enables restore only after validated content loads", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => void order.push("flush"));
    vi.spyOn(quiltorClient.application.backup, "list").mockImplementation(async () => {
      order.push("list");
      return { ok: true, backups: [backups[0]] };
    });
    vi.spyOn(quiltorClient.application.backup, "preview").mockImplementation(async () => {
      order.push("preview");
      return { ok: true, documents: previewDocuments("Gesicherter Prolog") };
    });
    const restore = vi.spyOn(quiltorClient.application.backup, "restore");
    renderDialog({ flush });

    const backup = await within(screen.getByRole("navigation", { name: "Sicherungen" })).findByRole(
      "button",
      { name: /2 KB/ },
    );
    expect(order).toEqual(["flush", "list"]);
    fireEvent.click(backup);
    expect(
      screen.queryByRole("button", { name: "Sicherung wiederherstellen" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Gesicherter Prolog")).toBeVisible();
    expect(screen.getByText("Der echte Text aus der Sicherung.")).toBeVisible();
    expect(screen.getByText("1 zurückgestellt")).toBeVisible();
    expect(screen.getByText("1 im Papierkorb")).toBeVisible();
    expect(screen.getByText("1 Figuren und Orte")).toBeVisible();
    expect(screen.getByText("1 Storyboards")).toBeVisible();
    expect(order).toEqual(["flush", "list", "flush", "preview"]);

    fireEvent.click(screen.getByRole("button", { name: "Sicherung wiederherstellen" }));
    expect(screen.getByRole("alertdialog", { name: "Sicherung wiederherstellen" })).toBeVisible();
    expect(restore).not.toHaveBeenCalled();
  });

  it("keeps restore unavailable after preview or flush failure", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({
      ok: true,
      backups: [backups[0]],
    });
    const preview = vi
      .spyOn(quiltorClient.application.backup, "preview")
      .mockRejectedValue(new Error("Die Sicherung ist beschädigt"));
    const flush = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const view = renderDialog({ flush });
    const backup = await screen.findByRole("button", { name: /2 KB/ });
    fireEvent.click(backup);
    expect(await screen.findByRole("alert")).toHaveTextContent("Die Sicherung ist beschädigt");
    expect(
      screen.queryByRole("button", { name: "Sicherung wiederherstellen" }),
    ).not.toBeInTheDocument();

    view.unmount();
    vi.restoreAllMocks();
    vi.spyOn(quiltorClient.application.backup, "location").mockResolvedValue({
      ok: true,
      storage: {
        databasePath: "db",
        backupDirectory: "backups",
        lastSuccessfulBackup: null,
        scope: "application-host",
        canOpenFolder: false,
      },
    });
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({
      ok: true,
      backups: [backups[0]],
    });
    const rejectingFlush = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Entwurf bleibt ungespeichert"));
    renderDialog({ flush: rejectingFlush });
    fireEvent.click(await screen.findByRole("button", { name: /2 KB/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entwurf bleibt ungespeichert");
    expect(preview).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Sicherung wiederherstellen" }),
    ).not.toBeInTheDocument();
  });

  it("ignores a late preview response after another backup is selected", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({ ok: true, backups });
    const first = deferred<{ ok: true; documents: BackupPreviewDocuments }>();
    const second = deferred<{ ok: true; documents: BackupPreviewDocuments }>();
    vi.spyOn(quiltorClient.application.backup, "preview").mockImplementation((name) =>
      name === "snapshot-1" ? first.promise : second.promise,
    );
    renderDialog();
    const list = screen.getByRole("navigation", { name: "Sicherungen" });
    const buttons = await within(list).findAllByRole("button");
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    second.resolve({ ok: true, documents: previewDocuments("Neuer Stand") });
    expect(await screen.findByText("Neuer Stand")).toBeVisible();
    first.resolve({ ok: true, documents: previewDocuments("Alter Stand") });
    await waitFor(() => expect(screen.queryByText("Alter Stand")).not.toBeInTheDocument());
    expect(screen.getByText("Neuer Stand")).toBeVisible();
  });

  it("flushes before restore and reports a committed restore mirror warning", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockResolvedValue({
      ok: true,
      backups: [backups[0]],
    });
    vi.spyOn(quiltorClient.application.backup, "preview").mockResolvedValue({
      ok: true,
      documents: previewDocuments("Warnung"),
    });
    const restore = vi.spyOn(quiltorClient.application.backup, "restore").mockResolvedValue({
      ok: true,
      warnings: ["backup.mirror_failed"],
    });
    const flush = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderDialog({ flush });
    fireEvent.click(await screen.findByRole("button", { name: /2 KB/ }));
    await screen.findByText("Warnung");
    fireEvent.click(screen.getByRole("button", { name: "Sicherung wiederherstellen" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sicherung wiederherstellen" });

    vi.useFakeTimers();
    try {
      const confirm = within(dialog).getByRole("button", { name: /gedrückt halten/i });
      fireEvent.pointerDown(confirm, {
        pointerId: 1,
      });
      fireEvent.pointerDown(confirm, { pointerId: 2 });
      await vi.advanceTimersByTimeAsync(3000);
    } finally {
      vi.useRealTimers();
    }

    expect(
      await screen.findByText(/Spiegeldateien konnten nicht aktualisiert werden/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Quiltor neu laden" })).toBeVisible();
    expect(flush).toHaveBeenCalledTimes(3);
    expect(restore).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the close action accessible and reports list failures", async () => {
    vi.spyOn(quiltorClient.application.backup, "list").mockRejectedValue(new Error("offline"));
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
