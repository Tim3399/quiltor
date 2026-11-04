import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import type { Manuscript } from "../manuscript";
import type { SnapshotInfo } from "./model";
import { startingVersionsTab, VersionsDialog } from "./VersionsDialog";

// The backup and sync bodies are tested with their own dialogs; here they are stand-ins that
// show what the shell handed them. The versions tab is the real one, over a mocked gateway.
const hosted = vi.hoisted(() => ({
  backups: { onBusyChange: undefined as ((busy: boolean) => void) | undefined },
  sync: { onBusyChange: undefined as ((busy: boolean) => void) | undefined },
}));

vi.mock("../backup/BackupDialog", () => ({
  BackupDialog: (props: { embedded?: boolean; onBusyChange?: (busy: boolean) => void }) => {
    hosted.backups.onBusyChange = props.onBusyChange;
    return <div data-testid="backups" data-embedded={String(props.embedded)} />;
  },
}));
vi.mock("../cloud/CloudDialog", () => ({
  CloudDialog: (props: { embedded?: boolean; onBusyChange?: (busy: boolean) => void }) => {
    hosted.sync.onBusyChange = props.onBusyChange;
    return <div data-testid="sync" data-embedded={String(props.embedded)} />;
  },
}));

const manual: SnapshotInfo = {
  hash: "commit-manual",
  shortHash: "abc1234",
  date: "2026-10-28T12:20:00",
  subject: "Vor dem Umbau",
  kind: "manual",
};
const beforeRestore: SnapshotInfo = {
  hash: "commit-before",
  shortHash: "def5678",
  date: "2026-10-29T09:05:00",
  subject: "Before restore",
  kind: "before-restore",
};

const history = quiltorClient.application.history;

let commits: SnapshotInfo[];
let calls: string[];
let restore: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

beforeEach(() => {
  commits = [manual];
  calls = [];
  vi.spyOn(history, "log").mockImplementation(async () => ({ ok: true, commits }));
  vi.spyOn(history, "diff").mockResolvedValue({ ok: true, diff: "", newFiles: [], mode: "word" });
  vi.spyOn(quiltorClient.application.backup, "status").mockResolvedValue({
    suggestedMessage: 'Chapter "Anfang" edited',
  } as Awaited<ReturnType<typeof quiltorClient.application.backup.status>>);
  restore = vi.fn(async (id: string) => {
    calls.push(`restore:${id}`);
  });
  vi.spyOn(history, "restore").mockImplementation(restore);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const manuscript = { chapters: [], trash: [] } as unknown as Manuscript;

function renderDialog(
  props: Partial<React.ComponentProps<typeof VersionsDialog>> = {},
  onClose = vi.fn(),
) {
  const onDocumentsReplaced = vi.fn(() => calls.push("replaced"));
  const flush = vi.fn(async () => {
    calls.push("flush");
  });
  render(
    <I18nProvider>
      <VersionsDialog
        onClose={onClose}
        flush={flush}
        manuscript={manuscript}
        onDocumentsReplaced={onDocumentsReplaced}
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose, onDocumentsReplaced, flush };
}

const tab = (name: string) => screen.getByRole("tab", { name });
const states = () => screen.getByRole("navigation", { name: "Stände" });
const noteField = () => screen.getByRole("textbox", { name: "Was hat sich geändert?" });
const saveButton = () => screen.getByRole("button", { name: "Version festhalten" });

async function chooseManualVersion() {
  fireEvent.click(await within(states()).findByRole("button", { name: /Vor dem Umbau/ }));
}

describe("VersionsDialog", () => {
  it("names itself and offers the three tabs, starting on versions", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Versionen & Sicherungen" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
      "Versionen",
      "Automatische Sicherungen",
      "Mit anderen Geräten abgleichen",
    ]);
    expect(tab("Versionen")).toHaveAttribute("aria-selected", "true");
    expect(await within(states()).findByRole("button", { name: /Vor dem Umbau/ })).toBeVisible();
    expect(screen.queryByTestId("backups")).toBeNull();
    expect(screen.queryByTestId("sync")).toBeNull();
  });

  it.each([
    ["backups", "Automatische Sicherungen"],
    ["sync", "Mit anderen Geräten abgleichen"],
  ] as const)("starts on the %s tab it was asked for", (start, name) => {
    renderDialog({ tab: start });
    expect(tab(name)).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(screen.getByTestId(start)).toHaveAttribute("data-embedded", "true");
  });

  it("shows only the body of the selected tab and switches on activation", () => {
    renderDialog({ tab: "backups" });
    expect(screen.queryByRole("navigation", { name: "Stände" })).toBeNull();
    fireEvent.click(tab("Mit anderen Geräten abgleichen"));
    expect(screen.getByTestId("sync")).toBeInTheDocument();
    expect(screen.queryByTestId("backups")).toBeNull();
  });

  it("puts the cursor into the note field only when asked", async () => {
    renderDialog({ focusNote: true });
    await waitFor(() => expect(noteField()).toHaveFocus());
    cleanup();
    renderDialog();
    expect(noteField()).not.toHaveFocus();
  });

  it("has no sync tab where syncing is not available, and a sync start falls back", () => {
    renderDialog({ tab: "sync", syncAvailable: false });
    expect(screen.queryByRole("tab", { name: "Mit anderen Geräten abgleichen" })).toBeNull();
    expect(tab("Versionen")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("sync")).toBeNull();
  });

  it("keeps the sync tab when the installation does not say (an older server)", () => {
    renderDialog({ tab: "sync", syncAvailable: undefined });
    expect(tab("Mit anderen Geräten abgleichen")).toHaveAttribute("aria-selected", "true");
  });

  it("neither switches tabs nor closes while a restore is running", () => {
    const { onClose } = renderDialog({ tab: "backups" });
    act(() => hosted.backups.onBusyChange?.(true));
    expect(tab("Versionen")).toBeDisabled();
    expect(tab("Mit anderen Geräten abgleichen")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).not.toHaveBeenCalled();

    act(() => hosted.backups.onBusyChange?.(false));
    expect(tab("Versionen")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("holds the sync tab in place while a sync is running", () => {
    renderDialog({ tab: "sync" });
    act(() => hosted.sync.onBusyChange?.(true));
    expect(tab("Automatische Sicherungen")).toBeDisabled();
  });
});

describe("VersionsDialog, holding on to a version", () => {
  it("saves locally only, without an upload choice, and selects the new version", async () => {
    const save = vi
      .spyOn(quiltorClient.application.backup, "saveSnapshot")
      .mockImplementation(async () => {
        calls.push("save");
        commits = [{ ...manual, hash: "commit-new", shortHash: "new0001", subject: "Neu" }, manual];
        return {} as Awaited<ReturnType<typeof quiltorClient.application.backup.saveSnapshot>>;
      });
    renderDialog();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /hochladen|anmelden/i })).toBeNull();

    calls = [];
    fireEvent.change(noteField(), { target: { value: "Vor dem Umbau" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("Vor dem Umbau", false));
    expect(calls.slice(0, 2)).toEqual(["flush", "save"]);
    const created = await within(states()).findByRole("button", { name: /Neu/ });
    await waitFor(() => expect(created).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("status")).toHaveTextContent("Version festgehalten.");
  });

  it("keeps the server's suggestion out of the note and sends an empty note so the server names it", async () => {
    const save = vi
      .spyOn(quiltorClient.application.backup, "saveSnapshot")
      .mockResolvedValue(
        {} as Awaited<ReturnType<typeof quiltorClient.application.backup.saveSnapshot>>,
      );
    renderDialog();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    // The author sees no server wording to edit, only a hint what an empty note does.
    expect(noteField()).toHaveValue("");
    expect(noteField()).toHaveAttribute(
      "placeholder",
      "Leer lassen, dann beschreibt Quiltor die Änderung selbst.",
    );
    fireEvent.click(saveButton());
    // An empty note is the flag: the server names the snapshot and records kind "changes" (T-85).
    await waitFor(() => expect(save).toHaveBeenCalledWith("", false));
  });
});

describe("VersionsDialog, restoring a version", () => {
  it("offers no restore for the current state", async () => {
    renderDialog();
    await within(states()).findByRole("button", { name: /Vor dem Umbau/ });
    expect(within(states()).getByRole("button", { name: /Aktueller Stand/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Diese Version wiederherstellen" })).toBeNull();
    await chooseManualVersion();
    expect(screen.getByRole("button", { name: "Diese Version wiederherstellen" })).toBeVisible();
  });

  it("asks first, then saves, restores and hands the documents over, in that order", async () => {
    const { onDocumentsReplaced, onClose } = renderDialog();
    await chooseManualVersion();
    fireEvent.click(screen.getByRole("button", { name: "Diese Version wiederherstellen" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent(
      "Version „28.10.2026, 12:20 · Vor dem Umbau“ wiederherstellen? Dein aktueller Stand wird vorher als Version festgehalten, du kannst also zurück.",
    );
    expect(restore).not.toHaveBeenCalled();

    calls = [];
    commits = [beforeRestore, manual];
    fireEvent.click(within(confirm).getByRole("button", { name: "Wiederherstellen" }));
    await waitFor(() => expect(onDocumentsReplaced).toHaveBeenCalledOnce());
    expect(calls).toEqual(["flush", "restore:commit-manual", "replaced"]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Version wiederhergestellt. Dein vorheriger Stand ist als „Vor Wiederherstellung“ festgehalten.",
    );
    // The list is read again and shows the state the server held on to first.
    expect(
      await within(states()).findByRole("button", { name: /Vor Wiederherstellung, 29\.10\.2026/ }),
    ).toBeVisible();
    // The workspace is stale now: the dialog stays until the author reloads.
    fireEvent.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Quiltor neu laden" })).toBeVisible();
  });

  it("sends nothing to the server when the open work could not be saved", async () => {
    const { onDocumentsReplaced, flush } = renderDialog();
    await chooseManualVersion();
    flush.mockRejectedValueOnce(new Error("Draft could not be saved"));
    fireEvent.click(screen.getByRole("button", { name: "Diese Version wiederherstellen" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Wiederherstellen" }),
    );
    expect(await screen.findByText("Draft could not be saved")).toBeVisible();
    expect(restore).not.toHaveBeenCalled();
    expect(onDocumentsReplaced).not.toHaveBeenCalled();
  });

  it("restores once, however often the confirmation is pressed", async () => {
    let finish!: () => void;
    restore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { onClose } = renderDialog();
    await chooseManualVersion();
    fireEvent.click(screen.getByRole("button", { name: "Diese Version wiederherstellen" }));
    const confirmButton = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Wiederherstellen",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(restore).toHaveBeenCalledOnce());
    // While it runs, the dialog can be neither left nor switched away from. The confirmation
    // stays on top, so the sheet behind it is read as hidden.
    expect(
      screen.getByRole("tab", { name: "Automatische Sicherungen", hidden: true }),
    ).toBeDisabled();
    const sheetClose = screen
      .getAllByRole("button", { name: "Dialog schließen", hidden: true })
      .find((button) => !screen.getByRole("alertdialog").contains(button));
    fireEvent.click(sheetClose as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(restore).toHaveBeenCalledOnce();
  });
});

describe("startingVersionsTab", () => {
  it("falls back to versions for a sync request without a sync tab", () => {
    expect(startingVersionsTab("sync", false)).toBe("versions");
    expect(startingVersionsTab("sync", true)).toBe("sync");
    expect(startingVersionsTab(undefined, true)).toBe("versions");
    expect(startingVersionsTab("backups", false)).toBe("backups");
  });
});
