import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../../modules/manuscript";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
import { App } from "../Application";
import type { useHistoryState } from "./useHistoryState";

const shell = vi.hoisted(() => ({ syncAvailable: true as boolean | null }));
vi.mock("../shell/useShellStatus", () => ({
  useShellStatus: () => ({
    account: { email: "author@example.org" },
    logout: vi.fn(),
  }),
}));
// Device sync comes from the capabilities since T-102; null is "not answered yet".
vi.mock("../shell/useCapabilities", () => ({
  useCapabilities: () => ({
    instance:
      shell.syncAvailable === null
        ? null
        : { multiUser: true, signOut: true, deviceSync: shell.syncAvailable },
  }),
}));
vi.mock("../shell/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    preference: "light",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));
vi.mock("./WorkspaceSurface", () => ({
  WorkspaceSurface: ({
    manuscript,
    manuscriptHistory,
  }: {
    manuscript: Manuscript;
    manuscriptHistory: ReturnType<typeof useHistoryState<Manuscript>>;
  }) => (
    <button
      type="button"
      onClick={() =>
        manuscriptHistory.change({
          ...manuscript,
          chapters: manuscript.chapters.map((chapter, index) =>
            index === 0 ? { ...chapter, body: "Entwurf in A" } : chapter,
          ),
        })
      }
    >
      {manuscript.chapters[0]?.body}
    </button>
  ),
}));

const worldA = { id: "world-a", title: "Welt A", backupUrl: "", updated: "2026-10-31T10:00:00Z" };
const worldB = { id: "world-b", title: "Welt B", backupUrl: "", updated: "2026-10-31T10:05:00Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const wait = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

// The world the gateway pointed at when each save left; "" means no world was selected.
let saves: { family: string; world: string; body?: string }[];
let selected: string;
let holdManuscriptB: ReturnType<typeof deferred<void>> | null;

beforeEach(() => {
  saves = [];
  selected = "";
  holdManuscriptB = null;
  history.replaceState(null, "", "/");
  const application = quiltorClient.application;
  vi.spyOn(application.worlds, "select").mockImplementation((id) => {
    selected = id;
  });
  vi.spyOn(application.worlds, "list").mockResolvedValue({ ok: true, worlds: [worldA] });
  vi.spyOn(application.worlds, "open").mockResolvedValue({ ok: true, world: worldA });
  vi.spyOn(application.worlds, "create").mockResolvedValue({ ok: true, world: worldB });
  vi.spyOn(application.manuscript, "load").mockImplementation(async () => {
    const world = selected;
    if (world === worldB.id && holdManuscriptB) await holdManuscriptB.promise;
    return {
      chapters: [
        {
          id: "chapter-1",
          title: "Eins",
          body: world === worldA.id ? "Anfang in A" : "Anfang in B",
          note: "",
        },
      ],
    };
  });
  vi.spyOn(application.storyWorld, "load").mockResolvedValue({ nodes: [], edges: [] });
  vi.spyOn(application.storyboards, "load").mockResolvedValue({
    boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
    nodes: [],
    edges: [],
  });
  const saved = { ok: true as const, zeit: "2026-10-31T10:10:00Z", revision: 4 };
  vi.spyOn(application.manuscript, "save").mockImplementation(async (value) => {
    saves.push({ family: "manuscript", world: selected, body: value.chapters[0]?.body });
    return saved;
  });
  vi.spyOn(application.storyWorld, "save").mockImplementation(async () => {
    saves.push({ family: "figures", world: selected });
    return saved;
  });
  vi.spyOn(application.storyboards, "save").mockImplementation(async () => {
    saves.push({ family: "storyboards", world: selected });
    return saved;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("documents stay bound to the world they were loaded for", () => {
  it("never saves a closed world's undo into the next world (P-R2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Welt A – Welt öffnen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Anfang in A" }));
    await wait(1000);
    expect(saves).toEqual([{ family: "manuscript", world: worldA.id, body: "Entwurf in A" }]);

    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Zur Weltauswahl" }));
    fireEvent.click(await screen.findByRole("button", { name: "Neue Welt" }));
    fireEvent.change(screen.getByPlaceholderText("Der letzte Garten"), {
      target: { value: "Welt B" },
    });
    const create = screen.getByRole("button", { name: "Welt erstellen" });
    create.focus();
    fireEvent.keyDown(create, { key: "z", ctrlKey: true });

    holdManuscriptB = deferred<void>();
    fireEvent.click(create);
    await waitFor(() => expect(selected).toBe(worldB.id));
    await wait(1000);
    holdManuscriptB.resolve();
    expect(await screen.findByRole("button", { name: "Anfang in B" })).toBeVisible();
    await wait(1000);

    expect(saves.filter((save) => save.world !== worldA.id)).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(
      warn.mock.calls.some((call) => String(call[0]).startsWith("[quiltor] save refused")),
    ).toBe(false);
  });
});

async function openWorldAndSaveOnce() {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Welt A – Welt öffnen" }));
  fireEvent.click(await screen.findByRole("button", { name: "Anfang in A" }));
  await wait(1000);
  expect(saves).toHaveLength(1);
}

async function undoAndSaveBehind(focused: HTMLElement) {
  focused.focus();
  // Undo and redo are both edits at the released binding; each save attempt must be refused.
  fireEvent.keyDown(focused, { key: "z", ctrlKey: true });
  await wait(50);
  fireEvent.keyDown(focused, { key: "z", ctrlKey: true, shiftKey: true });
  await wait(1000);
  fireEvent.keyDown(focused, { key: "s", ctrlKey: true });
  await wait(100);
}

function mockBackupRestore() {
  const backup = quiltorClient.application.backup;
  vi.spyOn(backup, "location").mockResolvedValue({
    ok: true,
    storage: {
      databasePath: "C:\\Quiltor\\world.sqlite3",
      backupDirectory: "C:\\Quiltor\\backups",
      lastSuccessfulBackup: "2026-10-30T08:30:00Z",
      scope: "application-host",
      canOpenFolder: false,
    },
  });
  vi.spyOn(backup, "list").mockResolvedValue({
    ok: true,
    backups: [{ name: "snapshot-1", created: "2026-10-30T08:30:00Z", size: 2048 }],
  });
  vi.spyOn(backup, "preview").mockResolvedValue({
    ok: true,
    documents: {
      manuscript: {
        chapters: [{ id: "chapter-1", title: "Sicherung", body: "Alter Stand", note: "" }],
      },
      figures: { nodes: [], edges: [] },
      storyboards: { boards: [], nodes: [], edges: [] },
    },
  });
  return vi
    .spyOn(backup, "restore")
    .mockResolvedValue({ ok: true, warnings: ["backup.mirror_failed"] });
}

// The menu has one entry for versions, backups and sync; each is a tab of the dialog it opens.
async function openVersionsTab(name: string) {
  fireEvent.click(screen.getByRole("menuitem", { name: "Versionen & Sicherungen" }));
  fireEvent.click(await screen.findByRole("tab", { name }));
}

async function restoreBackupBehindReload() {
  fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
  await openVersionsTab("Automatische Sicherungen");
  fireEvent.click(await screen.findByRole("button", { name: /2 KB/ }));
  await screen.findByText("Sicherung");
  fireEvent.click(screen.getByRole("button", { name: "Sicherung wiederherstellen" }));
  const dialog = screen.getByRole("alertdialog", { name: "Sicherung wiederherstellen" });
  vi.useFakeTimers();
  try {
    const confirm = within(dialog).getByRole("button", { name: /gedrückt halten/i });
    fireEvent.pointerDown(confirm, { pointerId: 1 });
    await vi.advanceTimersByTimeAsync(3000);
  } finally {
    vi.useRealTimers();
  }
  return screen.findByRole("button", { name: "Quiltor neu laden" });
}

const refusedSave = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.some((call) => String(call[0]).startsWith("[quiltor] save refused"));

describe("a world replaced on the server is never saved over (P-Q4)", () => {
  it("refuses every save after a backup restore that stops before reloading", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const restore = mockBackupRestore();
    await openWorldAndSaveOnce();

    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    await openVersionsTab("Automatische Sicherungen");
    fireEvent.click(await screen.findByRole("button", { name: /2 KB/ }));
    await screen.findByText("Sicherung");
    fireEvent.click(screen.getByRole("button", { name: "Sicherung wiederherstellen" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sicherung wiederherstellen" });
    vi.useFakeTimers();
    try {
      const confirm = within(dialog).getByRole("button", { name: /gedrückt halten/i });
      fireEvent.pointerDown(confirm, { pointerId: 1 });
      await vi.advanceTimersByTimeAsync(3000);
    } finally {
      vi.useRealTimers();
    }
    const reload = await screen.findByRole("button", { name: "Quiltor neu laden" });
    expect(restore).toHaveBeenCalledOnce();

    await undoAndSaveBehind(reload);
    expect(saves).toHaveLength(1);
    expect(refusedSave(warn)).toBe(true);
  });

  it("asks before unloading after a single edit behind the restore dialog (O1, T-100)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockBackupRestore();
    await openWorldAndSaveOnce();
    const reload = await restoreBackupBehindReload();

    // One edit only: the documents stay on screen, so it is a change, not a fresh load.
    reload.focus();
    fireEvent.keyDown(reload, { key: "z", ctrlKey: true });
    await wait(1000);
    expect(saves).toHaveLength(1);
    expect(refusedSave(warn)).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("refuses every save after a cloud synchronisation that requires a reload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(quiltorClient.application.backup, "loginStatus").mockResolvedValue({
      ok: true,
      configured: true,
      endpoint: "https://cloud.example.test",
      signedIn: true,
    });
    const status = {
      ok: true as const,
      configured: true,
      endpoint: "https://cloud.example.test/project",
      mode: "manual" as const,
      state: "remote-pending" as const,
      localFingerprint: "b".repeat(64),
      baseGeneration: 1,
      remote: { generation: 2, snapshotId: "a".repeat(64) },
      lastSyncedAt: "2026-10-30T09:00:00Z",
      account: {
        accountId: "account-1",
        access: "read-write" as const,
        usedBytes: 4096,
        limitBytes: 8192,
        deleteAfter: null,
      },
    };
    vi.spyOn(quiltorClient.application.synchronization, "status").mockResolvedValue(status);
    vi.spyOn(quiltorClient.application.synchronization, "target").mockResolvedValue({
      ok: true,
      backupUrl: status.endpoint,
      source: "world",
      worldUrl: status.endpoint,
      operatorUrl: "",
    });
    vi.spyOn(quiltorClient.application.synchronization, "synchronize").mockResolvedValue({
      ok: true,
      status: { ...status, state: "synced", baseGeneration: 2 },
      reloadRequired: true,
    });
    await openWorldAndSaveOnce();

    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    await openVersionsTab("Mit anderen Geräten abgleichen");
    fireEvent.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    const reload = await screen.findByRole("button", { name: "Quiltor neu laden" });

    await undoAndSaveBehind(reload);
    expect(saves).toHaveLength(1);
    expect(refusedSave(warn)).toBe(true);
  });
});

describe("a server without device sync (D-61)", () => {
  afterEach(() => {
    shell.syncAvailable = true;
  });

  for (const [label, value] of [
    ["says so", false],
    ["has not answered yet", null],
  ] as const) {
    it(`offers no sync tab, command or address field while it ${label}`, async () => {
      shell.syncAvailable = value;
      render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Neue Welt" }));
      expect(await screen.findByLabelText("Titel der Welt oder des Buches")).toBeVisible();
      expect(screen.queryByLabelText("Cloud-Backup (optional)")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

      fireEvent.click(await screen.findByRole("button", { name: "Welt A – Welt öffnen" }));
      fireEvent.click(await screen.findByRole("button", { name: "Mehr" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Versionen & Sicherungen" }));
      expect(await screen.findByRole("tab", { name: "Automatische Sicherungen" })).toBeVisible();
      expect(
        screen.queryByRole("tab", { name: "Mit anderen Geräten abgleichen" }),
      ).not.toBeInTheDocument();
    });
  }

  it("offers the address field when it syncs", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Neue Welt" }));
    expect(await screen.findByLabelText("Cloud-Backup (optional)")).toBeVisible();
  });
});

describe("a world opened from the address (P-URL)", () => {
  it("is loaded once, however the workspace state changes afterwards", async () => {
    history.replaceState(null, "", `/?world=${worldA.id}`);
    const application = quiltorClient.application;
    vi.mocked(application.manuscript.save).mockRejectedValueOnce(
      new ApplicationGatewayError("Konflikt", "document.revision_conflict", {
        category: "conflict",
        retryable: true,
      }),
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Anfang in A" }));
    await wait(1000);
    fireEvent.click(await screen.findByRole("button", { name: "Entwurf retten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Schließen" }));
    fireEvent.click(screen.getByRole("button", { name: "Entwurf in A" }));
    await wait(1000);

    expect(application.worlds.list).toHaveBeenCalledOnce();
    expect(application.worlds.open).toHaveBeenCalledOnce();
    expect(application.manuscript.load).toHaveBeenCalledOnce();
  });
});
