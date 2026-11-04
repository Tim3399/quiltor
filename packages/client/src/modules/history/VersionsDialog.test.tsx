import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../manuscript";
import { startingVersionsTab, VersionsDialog } from "./VersionsDialog";

// The bodies are tested with their own dialogs. Here they are stand-ins that show what the
// shell handed them, so this file is about the shell: tabs, start tab, locks, hand-over.
const hosted = vi.hoisted(() => ({
  backups: { onBusyChange: undefined as ((busy: boolean) => void) | undefined },
  sync: { onBusyChange: undefined as ((busy: boolean) => void) | undefined },
  snapshot: { onSaved: undefined as (() => void) | undefined },
  historyMounts: 0,
}));

vi.mock("./SnapshotDialog", () => ({
  SnapshotDialog: (props: {
    embedded?: boolean;
    autoFocusMessage?: boolean;
    onSaved?: () => void;
  }) => {
    hosted.snapshot.onSaved = props.onSaved;
    return (
      <div
        data-testid="snapshot"
        data-embedded={String(props.embedded)}
        data-focus-note={String(props.autoFocusMessage)}
      />
    );
  },
}));
vi.mock("./HistoryDialog", async () => {
  const { useEffect } = await import("react");
  return {
    HistoryDialog: (props: { embedded?: boolean }) => {
      useEffect(() => {
        hosted.historyMounts += 1;
      }, []);
      return <div data-testid="history" data-embedded={String(props.embedded)} />;
    },
  };
});
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

afterEach(() => {
  cleanup();
  hosted.historyMounts = 0;
});

const manuscript = { chapters: [], trash: [] } as unknown as Manuscript;

function renderDialog(
  props: Partial<React.ComponentProps<typeof VersionsDialog>> = {},
  onClose = vi.fn(),
) {
  render(
    <I18nProvider>
      <VersionsDialog
        onClose={onClose}
        flush={() => Promise.resolve()}
        manuscript={manuscript}
        onDocumentsReplaced={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose };
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("VersionsDialog", () => {
  it("names itself and offers the three tabs, hosting the old dialogs without their frames", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Versionen & Sicherungen" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
      "Versionen",
      "Automatische Sicherungen",
      "Mit anderen Geräten abgleichen",
    ]);
    // Versions: the note field and the list beside it, both as bodies.
    expect(screen.getByTestId("snapshot")).toHaveAttribute("data-embedded", "true");
    expect(screen.getByTestId("history")).toHaveAttribute("data-embedded", "true");
    expect(screen.queryByTestId("backups")).toBeNull();
    expect(screen.queryByTestId("sync")).toBeNull();
  });

  it.each([
    ["backups", "Automatische Sicherungen"],
    ["sync", "Mit anderen Geräten abgleichen"],
    ["versions", "Versionen"],
  ] as const)("starts on the %s tab it was asked for", (start, name) => {
    renderDialog({ tab: start });
    expect(tab(name)).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(screen.getByTestId(start === "versions" ? "history" : start)).toBeInTheDocument();
  });

  it("shows only the body of the selected tab and switches on activation", () => {
    renderDialog({ tab: "backups" });
    expect(screen.queryByTestId("history")).toBeNull();
    fireEvent.click(tab("Mit anderen Geräten abgleichen"));
    expect(screen.getByTestId("sync")).toBeInTheDocument();
    expect(screen.queryByTestId("backups")).toBeNull();
  });

  it("hands the note focus to the versions tab only when asked", () => {
    renderDialog({ focusNote: true });
    expect(screen.getByTestId("snapshot")).toHaveAttribute("data-focus-note", "true");
    cleanup();
    renderDialog();
    expect(screen.getByTestId("snapshot")).toHaveAttribute("data-focus-note", "false");
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

  it("reloads the version list after a version was saved", () => {
    renderDialog();
    expect(hosted.historyMounts).toBe(1);
    act(() => hosted.snapshot.onSaved?.());
    expect(hosted.historyMounts).toBe(2);
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

describe("startingVersionsTab", () => {
  it("falls back to versions for a sync request without a sync tab", () => {
    expect(startingVersionsTab("sync", false)).toBe("versions");
    expect(startingVersionsTab("sync", true)).toBe("sync");
    expect(startingVersionsTab(undefined, true)).toBe("versions");
    expect(startingVersionsTab("backups", false)).toBe("backups");
  });
});
