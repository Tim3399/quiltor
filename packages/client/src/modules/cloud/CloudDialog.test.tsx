import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  ApplicationGatewayError,
  type CloudSyncPreview,
  type CloudSyncStatus,
  quiltorClient,
} from "../../platform";
import type { Manuscript } from "../manuscript";
import { CloudDialog } from "./CloudDialog";

const LOCAL_FINGERPRINT = "b".repeat(64);
const REMOTE_SNAPSHOT = "a".repeat(64);

const localManuscript: Manuscript = {
  chapters: [{ id: "local", title: "Lokaler Anfang", body: "Lokaler Text", note: "" }],
  trash: [
    {
      chapter: { id: "local-trash", title: "Lokaler Rest", body: "Verworfen", note: "" },
      deletedAt: "2026-09-19T10:00:00.000Z",
      originalFolderPath: [],
      treeItem: {
        id: "tree-local-trash",
        kind: "chapter",
        chapterId: "local-trash",
        position: 0,
      },
    },
  ],
};

function cloudStatus(overrides: Partial<CloudSyncStatus> = {}): CloudSyncStatus {
  return {
    ok: true,
    configured: true,
    endpoint: "https://cloud.example.test/project",
    mode: "manual",
    state: "conflict",
    localFingerprint: LOCAL_FINGERPRINT,
    baseGeneration: 1,
    remote: { generation: 2, snapshotId: REMOTE_SNAPSHOT },
    lastSyncedAt: "2026-09-19T09:00:00Z",
    account: {
      accountId: "account-1",
      access: "read-write",
      usedBytes: 4096,
      limitBytes: 8192,
      deleteAfter: null,
    },
    ...overrides,
  };
}

function remotePreview(overrides: Partial<CloudSyncPreview> = {}): CloudSyncPreview {
  return {
    ok: true,
    generation: 2,
    snapshotId: REMOTE_SNAPSHOT,
    documents: {
      manuscript: {
        chapters: [{ id: "remote", title: "Cloud-Anfang", body: "Cloud-Text", note: "" }],
        trash: [
          {
            chapter: { id: "remote-trash", title: "Cloud-Rest", body: "Alt", note: "" },
            deletedAt: "2026-09-18T10:00:00.000Z",
            originalFolderPath: [],
            treeItem: {
              id: "tree-remote-trash",
              kind: "chapter",
              chapterId: "remote-trash",
              position: 0,
            },
          },
        ],
      },
      figures: { nodes: [{ id: "mara", name: "Mara", x: 0, y: 0 }], edges: [] },
      storyboards: { boards: [{ id: "board", title: "Akt Eins" }], nodes: [], edges: [] },
    },
    ...overrides,
  };
}

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
  vi.spyOn(quiltorClient.application.backup, "loginStatus").mockResolvedValue({
    ok: true,
    configured: true,
    hosted: false,
    endpoint: "https://cloud.example.test",
    signedIn: true,
  });
  vi.spyOn(quiltorClient.application.backup, "beginLogin").mockResolvedValue({
    ok: true,
    authorizeUrl: "https://login.example.test/authorize",
    redirectUri: "http://127.0.0.1/callback",
  });
  vi.spyOn(quiltorClient.application.synchronization, "status").mockResolvedValue(cloudStatus());
  vi.spyOn(quiltorClient.application.synchronization, "preview").mockResolvedValue(remotePreview());
  vi.spyOn(quiltorClient.application.synchronization, "synchronize").mockResolvedValue({
    ok: true,
    status: cloudStatus({ state: "synced", baseGeneration: 2 }),
    reloadRequired: false,
  });
  vi.spyOn(quiltorClient.platform.externalNavigation, "open").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog({
  flush = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
  manuscript = localManuscript,
}: {
  flush?: () => Promise<void>;
  onClose?: () => void;
  manuscript?: Manuscript;
} = {}) {
  return {
    flush,
    onClose,
    ...render(
      <I18nProvider>
        <CloudDialog flush={flush} manuscript={manuscript} onClose={onClose} />
      </I18nProvider>,
    ),
  };
}

async function inspectConflict() {
  fireEvent.click(await screen.findByRole("button", { name: "Cloud-Fassung zum Vergleich laden" }));
  await screen.findByText("Cloud-Text");
}

describe("CloudDialog", () => {
  it("offers an explicit reviewed choice when this device has no shared baseline", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({ state: "unlinked", baseGeneration: null, lastSyncedAt: null }),
    );
    renderDialog();
    expect(await screen.findByText("Dieses Gerät wurde noch nicht abgeglichen")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Jetzt synchronisieren" })).not.toBeInTheDocument();
    const choose = screen.getByRole("button", { name: "Cloud-Fassung übernehmen" });
    expect(choose).toBeDisabled();
    await inspectConflict();
    expect(choose).toBeEnabled();
  });
  it("performs no cloud read or mutation when the initial flush fails", async () => {
    renderDialog({ flush: vi.fn().mockRejectedValue(new Error("Entwurf konnte nicht sichern")) });

    expect(await screen.findByRole("alert")).toHaveTextContent("Entwurf konnte nicht sichern");
    expect(quiltorClient.application.backup.loginStatus).not.toHaveBeenCalled();
    expect(quiltorClient.application.synchronization.status).not.toHaveBeenCalled();
    expect(quiltorClient.application.synchronization.preview).not.toHaveBeenCalled();
    expect(quiltorClient.application.synchronization.synchronize).not.toHaveBeenCalled();
  });

  it("explains unconfigured cloud without weakening local independence", async () => {
    vi.mocked(quiltorClient.application.backup.loginStatus).mockResolvedValue({
      ok: true,
      configured: false,
      hosted: false,
      endpoint: "",
      signedIn: false,
    });
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({
        configured: false,
        endpoint: "",
        state: "unconfigured",
        localFingerprint: "",
        baseGeneration: null,
        remote: { generation: 0, snapshotId: null },
        lastSyncedAt: null,
        account: undefined,
      }),
    );
    renderDialog();

    expect(await screen.findByText("Keine Cloud eingerichtet")).toBeVisible();
    expect(
      screen.getByText(/Schreiben, Papierkorb, Wiederherstellung und Projektexport/),
    ).toBeVisible();
    expect(screen.getByText(/Cloud-Ziel eingerichtet/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Jetzt synchronisieren" })).not.toBeInTheDocument();
    expect(quiltorClient.application.backup.beginLogin).not.toHaveBeenCalled();
  });

  it("offers a separate login for a configured signed-out target", async () => {
    vi.mocked(quiltorClient.application.backup.loginStatus).mockResolvedValue({
      ok: true,
      configured: true,
      hosted: false,
      endpoint: "https://cloud.example.test",
      signedIn: false,
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Bei der Sicherung anmelden" }));
    await waitFor(() => expect(quiltorClient.application.backup.beginLogin).toHaveBeenCalledOnce());
    expect(quiltorClient.platform.externalNavigation.open).toHaveBeenCalledWith(
      "https://login.example.test/authorize",
    );
    expect(quiltorClient.application.synchronization.status).not.toHaveBeenCalled();
    expect(quiltorClient.application.synchronization.synchronize).not.toHaveBeenCalled();
  });

  it("cannot resolve a conflict until a preview matches the current remote head", async () => {
    vi.mocked(quiltorClient.application.synchronization.preview).mockResolvedValue(
      remotePreview({ generation: 3, snapshotId: "c".repeat(64) }),
    );
    renderDialog();

    const keepLocal = await screen.findByRole("button", { name: "Lokale Fassung übernehmen" });
    const useRemote = screen.getByRole("button", { name: "Cloud-Fassung übernehmen" });
    expect(keepLocal).toBeDisabled();
    expect(useRemote).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cloud-Fassung zum Vergleich laden" }));

    await waitFor(() =>
      expect(quiltorClient.application.synchronization.status).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByText("Cloud-Text")).not.toBeInTheDocument();
    expect(keepLocal).toBeDisabled();
    expect(useRemote).toBeDisabled();
    expect(quiltorClient.application.synchronization.synchronize).not.toHaveBeenCalled();
  });

  it("compares local and trashed chapters and sends the guarded local choice after confirmation", async () => {
    renderDialog();
    await inspectConflict();

    fireEvent.click(screen.getByText("Lokaler Anfang"));
    fireEvent.click(screen.getByText("Lokaler Rest · Im Papierkorb"));
    fireEvent.click(screen.getByText("Cloud-Anfang"));
    fireEvent.click(screen.getByText("Cloud-Rest · Im Papierkorb"));
    expect(screen.getByText("Lokaler Text")).toBeVisible();
    expect(screen.getByText("Lokaler Rest · Im Papierkorb")).toBeVisible();
    expect(screen.getByText("Cloud-Text")).toBeVisible();
    expect(screen.getByText("Cloud-Rest · Im Papierkorb")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Lokale Fassung übernehmen" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Lokale Fassung übernehmen" });
    expect(quiltorClient.application.synchronization.synchronize).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Diese Fassung übernehmen" }));

    await waitFor(() =>
      expect(quiltorClient.application.synchronization.synchronize).toHaveBeenCalledWith({
        action: "keep-local",
        expectedGeneration: 2,
        expectedLocalFingerprint: LOCAL_FINGERPRINT,
      }),
    );
  });

  it("invalidates a loaded preview when status is refreshed", async () => {
    renderDialog();
    await inspectConflict();

    fireEvent.click(screen.getByRole("button", { name: "Status aktualisieren" }));
    await waitFor(() => expect(screen.queryByText("Cloud-Text")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Lokale Fassung übernehmen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cloud-Fassung übernehmen" })).toBeDisabled();
    expect(quiltorClient.application.synchronization.status).toHaveBeenCalledTimes(2);
  });

  it("retains remote metadata after a failed transfer without claiming synchronization", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({ state: "remote-pending" }),
    );
    vi.mocked(quiltorClient.application.synchronization.synchronize).mockRejectedValue(
      new Error("Cloud ist nicht erreichbar"),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cloud ist nicht erreichbar");
    expect(screen.getByText("https://cloud.example.test/project")).toBeVisible();
    expect(screen.getByText(/4\.096 Bytes belegt/)).toBeVisible();
    expect(screen.queryByText("Projektstand mit der Cloud abgeglichen")).not.toBeInTheDocument();
  });

  it("blocks read-only uploads while allowing a confirmed remote restore", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({
        account: {
          accountId: "account-read-only",
          access: "read-only",
          usedBytes: 4096,
          limitBytes: null,
          deleteAfter: null,
        },
      }),
    );
    renderDialog();
    await inspectConflict();

    expect(screen.getByRole("button", { name: "Lokale Fassung übernehmen" })).toBeDisabled();
    const useRemote = screen.getByRole("button", { name: "Cloud-Fassung übernehmen" });
    expect(useRemote).toBeEnabled();
    fireEvent.click(useRemote);
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Cloud-Fassung übernehmen" })).getByRole(
        "button",
        { name: "Diese Fassung übernehmen" },
      ),
    );

    await waitFor(() =>
      expect(quiltorClient.application.synchronization.synchronize).toHaveBeenCalledWith({
        action: "use-remote",
        expectedGeneration: 2,
        expectedLocalFingerprint: LOCAL_FINGERPRINT,
      }),
    );
  });

  it("locks closing and duplicate pulls after a confirmed restore until reload", async () => {
    const pending = deferred<{
      ok: true;
      status: CloudSyncStatus;
      reloadRequired: boolean;
    }>();
    vi.mocked(quiltorClient.application.synchronization.synchronize).mockReturnValue(
      pending.promise,
    );
    const onClose = vi.fn();
    renderDialog({ onClose });
    await inspectConflict();
    fireEvent.click(screen.getByRole("button", { name: "Cloud-Fassung übernehmen" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Cloud-Fassung übernehmen" })).getByRole(
        "button",
        { name: "Diese Fassung übernehmen" },
      ),
    );
    await waitFor(() =>
      expect(quiltorClient.application.synchronization.synchronize).toHaveBeenCalledOnce(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.click(screen.getByRole("button", { name: "Cloud-Fassung übernehmen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(quiltorClient.application.synchronization.synchronize).toHaveBeenCalledOnce();

    pending.resolve({
      ok: true,
      status: cloudStatus({ state: "synced", baseGeneration: 2 }),
      reloadRequired: true,
    });
    expect(await screen.findByRole("button", { name: "Quiltor neu laden" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Cloud-Fassung übernehmen" }),
    ).not.toBeInTheDocument();
  });

  it("does not start a second mutation while synchronization is pending", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({ state: "local-pending" }),
    );
    const pending = deferred<{
      ok: true;
      status: CloudSyncStatus;
      reloadRequired: boolean;
    }>();
    vi.mocked(quiltorClient.application.synchronization.synchronize).mockReturnValue(
      pending.promise,
    );
    renderDialog();

    const sync = await screen.findByRole("button", { name: "Jetzt synchronisieren" });
    fireEvent.click(sync);
    fireEvent.click(sync);
    await waitFor(() =>
      expect(quiltorClient.application.synchronization.synchronize).toHaveBeenCalledOnce(),
    );
    pending.resolve({
      ok: true,
      status: cloudStatus({ state: "synced", baseGeneration: 2 }),
      reloadRequired: false,
    });
    await waitFor(() => expect(sync).toBeEnabled());
  });

  it("blocks stale editing when applying and rollback cannot confirm the active version", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({ state: "remote-pending" }),
    );
    vi.mocked(quiltorClient.application.synchronization.synchronize).mockRejectedValue(
      new ApplicationGatewayError("Projektstand muss geprüft werden.", "sync.recovery_required"),
    );
    const { onClose } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    expect(await screen.findByText("Projektstand muss geprüft werden.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Quiltor neu laden" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/Dein lokaler Stand bleibt erhalten/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Der Cloud-Stand wurde übernommen/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Status aktualisieren" })).not.toBeInTheDocument();
  });

  it("requires reload after a committed pull whose baseline could not be saved", async () => {
    vi.mocked(quiltorClient.application.synchronization.status).mockResolvedValue(
      cloudStatus({ state: "remote-pending" }),
    );
    vi.mocked(quiltorClient.application.synchronization.synchronize).mockResolvedValue({
      ok: true,
      status: cloudStatus({ state: "unlinked", baseGeneration: null }),
      reloadRequired: true,
      warnings: ["sync.state_not_saved"],
    });
    const { onClose } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    expect(
      await screen.findByText(/Status konnte lokal nicht vollständig gespeichert/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Quiltor neu laden" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Jetzt synchronisieren" })).not.toBeInTheDocument();
  });
});
