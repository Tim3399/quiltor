import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterTree } from "./ChapterTree";
import type { Manuscript, ManuscriptStructure } from "./model";
import { TestProviders } from "./TextWorkspace.testSupport";

const structure: ManuscriptStructure = {
  folders: [{ id: "part-1", title: "Part one" }],
  items: [
    { id: "part-item", kind: "folder", folderId: "part-1", position: 0 },
    {
      id: "chapter-1-item",
      kind: "chapter",
      chapterId: "chapter-1",
      parentFolderId: "part-1",
      position: 0,
    },
    { id: "chapter-2-item", kind: "chapter", chapterId: "chapter-2", position: 1 },
  ],
};

const manuscript: Manuscript = {
  chapters: [
    { id: "chapter-1", title: "Opening", body: "One two", note: "" },
    { id: "chapter-2", title: "Arrival", body: "Three", note: "" },
  ],
  structure,
};

describe("ChapterTree", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("owns folder disclosure and row selection independently from the binder shell", () => {
    const onSelect = vi.fn();
    render(
      <TestProviders>
        <ChapterTree
          manuscript={manuscript}
          structure={structure}
          current={manuscript.chapters[0]}
          viewportMode="wide"
          onClose={vi.fn()}
          onSelect={onSelect}
          onStructureChange={vi.fn()}
        />
      </TestProviders>,
    );

    const tree = screen.getByRole("list", { name: "Kapitelstruktur" });
    const folder = within(tree).getByRole("button", { name: /^Part one, 1 Kapitel/ });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("quiltor:binder:collapsed:part-1")).toBe("true");

    fireEvent.click(within(tree).getByRole("button", { name: /Arrival/ }));
    expect(onSelect).toHaveBeenCalledWith("chapter-2");
  });

  it("creates a folder next to the active chapter level", () => {
    const onStructureChange = vi.fn();
    render(
      <TestProviders>
        <ChapterTree
          manuscript={manuscript}
          structure={structure}
          current={manuscript.chapters[0]}
          viewportMode="wide"
          onClose={vi.fn()}
          onSelect={vi.fn()}
          onStructureChange={onStructureChange}
        />
      </TestProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ordner hinzufügen" }));
    expect(onStructureChange).toHaveBeenCalledWith(
      expect.objectContaining({
        folders: expect.arrayContaining([expect.objectContaining({ title: "Neuer Ordner" })]),
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "folder", parentFolderId: "part-1" }),
        ]),
      }),
    );
  });
});
