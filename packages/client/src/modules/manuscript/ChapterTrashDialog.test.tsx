import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterTrashDialog } from "./ChapterTrashDialog";
import type { Manuscript } from "./model";
import { TestProviders } from "./TextWorkspace.testSupport";
import { moveChapterToTrash } from "./trash";

afterEach(cleanup);

const trashed = (): Manuscript =>
  moveChapterToTrash(
    {
      chapters: [
        { id: "c1", title: "Ankunft", body: "Mara im Archiv", note: "" },
        { id: "c2", title: "Danach", body: "Meer", note: "" },
      ],
    },
    "c1",
    "2026-09-19T10:00:00.000Z",
  );

describe("ChapterTrashDialog", () => {
  it("searches deleted text and restores one entry", () => {
    const onChange = vi.fn();
    render(
      <TestProviders>
        <ChapterTrashDialog manuscript={trashed()} onChange={onChange} onClose={vi.fn()} />
      </TestProviders>,
    );
    const dialog = within(screen.getByRole("dialog", { name: "Papierkorb" }));
    fireEvent.change(dialog.getByLabelText("Gelöschte Kapitel durchsuchen"), {
      target: { value: "Archiv" },
    });
    expect(dialog.getByText("Ankunft")).toBeVisible();
    fireEvent.change(dialog.getByLabelText("Gelöschte Kapitel durchsuchen"), {
      target: { value: "Meer" },
    });
    expect(dialog.getByText("Keine gelöschten Kapitel gefunden.")).toBeVisible();
    fireEvent.change(dialog.getByLabelText("Gelöschte Kapitel durchsuchen"), {
      target: { value: "" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Kapitel wiederherstellen" }));
    expect(onChange.mock.calls[0][0].chapters.map((chapter: { id: string }) => chapter.id)).toEqual(
      ["c2", "c1"],
    );
  });

  it("requires separate confirmation before permanent deletion", () => {
    const onChange = vi.fn();
    render(
      <TestProviders>
        <ChapterTrashDialog manuscript={trashed()} onChange={onChange} onClose={vi.fn()} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    const confirmation = within(screen.getByRole("alertdialog", { name: "Endgültig löschen" }));
    fireEvent.click(confirmation.getByRole("button", { name: "Abbrechen" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Endgültig löschen" })).getByRole("button", {
        name: "Endgültig löschen",
      }),
    );
    expect(onChange.mock.calls[0][0].trash).toEqual([]);
  });

  it("explains root fallback before restore and retains missing story-time anchors", () => {
    const value = trashed();
    const entry = value.trash?.[0];
    if (!entry) throw new Error("trash fixture missing");
    entry.treeItem.parentFolderId = "removed-folder";
    entry.originalFolderPath = [{ id: "removed-folder", title: "Alter Teil" }];
    entry.chapter.storyTime = { startMomentId: "removed-moment" };
    const onChange = vi.fn();
    render(
      <TestProviders>
        <ChapterTrashDialog
          manuscript={value}
          availableMomentIds={new Set()}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </TestProviders>,
    );
    expect(screen.getByText(/ursprüngliche Ordner fehlt/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Kapitel wiederherstellen" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/gelöschten Zeitpunkt/);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Ankunft")).toBeVisible();
  });
});
