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

  it("filters set-aside chapters without making them unavailable", () => {
    const filtered = {
      ...manuscript,
      chapters: [manuscript.chapters[0], { ...manuscript.chapters[1], inBook: false }],
    };
    const onChapterFilter = vi.fn();
    const { rerender } = render(
      <TestProviders>
        <ChapterTree
          manuscript={filtered}
          structure={structure}
          current={filtered.chapters[0]}
          viewportMode="wide"
          chapterFilter="in-book"
          onChapterFilter={onChapterFilter}
          onClose={vi.fn()}
          onSelect={vi.fn()}
          onStructureChange={vi.fn()}
        />
      </TestProviders>,
    );

    expect(screen.getByRole("button", { name: /Opening/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Arrival/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zurückgestellt" }));
    expect(onChapterFilter).toHaveBeenCalledWith("set-aside");

    rerender(
      <TestProviders>
        <ChapterTree
          manuscript={filtered}
          structure={structure}
          current={filtered.chapters[1]}
          viewportMode="wide"
          chapterFilter="set-aside"
          onChapterFilter={onChapterFilter}
          onClose={vi.fn()}
          onSelect={vi.fn()}
          onStructureChange={vi.fn()}
        />
      </TestProviders>,
    );
    expect(screen.queryByRole("button", { name: /Opening/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Arrival/ })).toBeVisible();
    expect(document.querySelector(".chapter-set-aside")).toHaveTextContent("Zurückgestellt");
  });
});
