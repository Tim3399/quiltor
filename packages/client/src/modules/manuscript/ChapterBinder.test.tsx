import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./TextWorkspace.testSupport";
import { ChapterBinder } from "./ChapterBinder";
import { flattenChapterIds } from "./binder/manuscriptTree";
import type { Manuscript } from "./model";

const nestedManuscript: Manuscript = {
  chapters: [
    { id: "c1", title: "Ankunft", body: "Mara kommt an.", note: "" },
    { id: "c2", title: "Aufbruch", body: "Mara geht los.", note: "" },
  ],
  structure: {
    folders: [
      { id: "part", title: "Teil I" },
      { id: "arc", title: "Ankunftsbogen" },
    ],
    items: [
      { id: "part-item", kind: "folder", folderId: "part", position: 0 },
      { id: "c2-item", kind: "chapter", chapterId: "c2", position: 1 },
      {
        id: "arc-item",
        kind: "folder",
        folderId: "arc",
        parentFolderId: "part",
        position: 0,
      },
      {
        id: "c1-item",
        kind: "chapter",
        chapterId: "c1",
        parentFolderId: "arc",
        position: 0,
      },
    ],
  },
};

function createDataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
  } as unknown as DataTransfer;
}

function renderBinder(
  onStructureChange = vi.fn(),
  manuscript = nestedManuscript,
  onSelect = vi.fn(),
) {
  return {
    onStructureChange,
    onSelect,
    ...render(
      <TestProviders>
        <div className="binder">
          <ChapterBinder
            manuscript={manuscript}
            current={manuscript.chapters[0]}
            totalWords={6}
            viewportMode="wide"
            onClose={vi.fn()}
            onSelect={onSelect}
            onStructureChange={onStructureChange}
            onUpdateCurrent={vi.fn()}
            onExportCurrent={vi.fn()}
            onRequestDelete={vi.fn()}
          />
        </div>
      </TestProviders>,
    ),
  };
}

describe("ChapterBinder folders", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("renders arbitrary nesting with a useful chapter breadcrumb and persistent collapse", () => {
    renderBinder();

    expect(screen.getByText("Teil I / Ankunftsbogen")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: /Ordner einklappen/ })[0]);
    expect(screen.queryByText("Ankunftsbogen")).not.toBeInTheDocument();
    expect(localStorage.getItem("quiltor:binder:collapsed:part")).toBe("true");
  });

  it("moves a root chapter into a nested folder through the visible drop target", () => {
    const { onStructureChange, container } = renderBinder();
    const chapter = screen.getByRole("button", { name: /Aufbruch/ });
    const folder = screen.getByText("Ankunftsbogen").closest(".binder-folder-row")!;

    fireEvent.dragStart(chapter);
    fireEvent.dragOver(folder);
    fireEvent.drop(folder);

    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(flattenChapterIds(result)).toEqual(["c1", "c2"]);
    expect(result.items.find((item: { id: string }) => item.id === "c2-item").parentFolderId).toBe(
      "arc",
    );
    expect(within(container).getByText("Auf die oberste Ebene verschieben")).toBeInTheDocument();
  });

  it("starts folder drags only on the handle and carries the item id in DataTransfer", () => {
    const onStructureChange = vi.fn();
    renderBinder(onStructureChange);
    const partRow = screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row")!;
    const toggle = within(partRow).getByRole("button", { name: /Teil I, 1 Kapitel/ });
    const handle = partRow.querySelector<HTMLElement>('.binder-drag-handle[draggable="true"]')!;
    const rootTarget = screen.getByText("Auf die oberste Ebene verschieben");

    expect(partRow).not.toHaveAttribute("draggable");
    expect(handle).toBeInTheDocument();
    fireEvent.dragStart(toggle, { dataTransfer: createDataTransfer() });
    fireEvent.drop(rootTarget, { dataTransfer: createDataTransfer() });
    expect(onStructureChange).not.toHaveBeenCalled();

    const transfer = createDataTransfer();
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe("move");
    expect(transfer.setData).toHaveBeenCalledWith("application/x-quiltor-binder-item", "part-item");
    expect(rootTarget).toHaveAttribute("aria-hidden", "false");
    fireEvent.dragOver(rootTarget, { dataTransfer: transfer });
    expect(rootTarget).toHaveClass("is-active");
    fireEvent.drop(rootTarget, { dataTransfer: transfer });

    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(
      result.items.filter((item: { parentFolderId?: string }) => !item.parentFolderId),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "c2-item", position: 0 }),
        expect.objectContaining({ id: "part-item", position: 1 }),
      ]),
    );
    expect(rootTarget).toHaveAttribute("aria-hidden", "true");
  });

  it("uses chapter row halves for before/after ordering and keeps the explicit before zone", async () => {
    const manuscript: Manuscript = {
      chapters: [
        { id: "a", title: "Alpha", body: "", note: "" },
        { id: "b", title: "Beta", body: "", note: "" },
        { id: "c", title: "Gamma", body: "", note: "" },
      ],
    };
    const onStructureChange = vi.fn();
    const onSelect = vi.fn();
    const { container } = renderBinder(onStructureChange, manuscript, onSelect);
    const alpha = screen.getByRole("button", { name: /Alpha/ });
    const gamma = screen.getByRole("button", { name: /Gamma/ });
    vi.spyOn(alpha, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 144,
      height: 44,
    } as DOMRect);

    let transfer = createDataTransfer();
    fireEvent.dragStart(gamma, { dataTransfer: transfer });
    const dragOverAfter = createEvent.dragOver(alpha, { dataTransfer: transfer });
    Object.defineProperty(dragOverAfter, "clientY", { value: 140 });
    fireEvent(alpha, dragOverAfter);
    expect(alpha).toHaveAttribute("data-drop-position", "after");
    const dropAfter = createEvent.drop(alpha, { dataTransfer: transfer });
    Object.defineProperty(dropAfter, "clientY", { value: 140 });
    fireEvent(alpha, dropAfter);
    expect(flattenChapterIds(onStructureChange.mock.calls.at(-1)?.[0])).toEqual(["a", "c", "b"]);

    onStructureChange.mockClear();
    transfer = createDataTransfer();
    fireEvent.dragStart(gamma, { dataTransfer: transfer });
    const alphaEntry = alpha.closest<HTMLElement>(".binder-tree-entry")!;
    const before = alphaEntry.querySelector<HTMLElement>(":scope > .binder-drop-before")!;
    fireEvent.dragOver(before, { dataTransfer: transfer });
    expect(before).toHaveClass("is-active");
    fireEvent.drop(before, { dataTransfer: transfer });
    expect(flattenChapterIds(onStructureChange.mock.calls.at(-1)?.[0])).toEqual(["c", "a", "b"]);
    expect(container.querySelector(".binder-root-drop")).toBeInTheDocument();

    fireEvent.click(alpha);
    expect(onSelect).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("rejects cycle drops and expands a collapsed folder after a successful drop", () => {
    const onStructureChange = vi.fn();
    renderBinder(onStructureChange);
    const partRow = screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row")!;
    const arcRow = screen.getByText("Ankunftsbogen").closest<HTMLElement>(".binder-folder-row")!;
    const partHandle = partRow.querySelector<HTMLElement>('.binder-drag-handle[draggable="true"]')!;

    let transfer = createDataTransfer();
    fireEvent.dragStart(partHandle, { dataTransfer: transfer });
    fireEvent.dragOver(arcRow, { dataTransfer: transfer });
    expect(arcRow).not.toHaveClass("is-drop-target");
    fireEvent.drop(arcRow, { dataTransfer: transfer });
    expect(onStructureChange).not.toHaveBeenCalled();

    const arcToggle = within(arcRow).getByRole("button", { name: /Ankunftsbogen, 1 Kapitel/ });
    fireEvent.click(arcToggle);
    expect(arcToggle).toHaveAttribute("aria-expanded", "false");
    transfer = createDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: /Aufbruch/ }), {
      dataTransfer: transfer,
    });
    fireEvent.dragOver(arcRow, { dataTransfer: transfer });
    fireEvent.drop(arcRow, { dataTransfer: transfer });

    expect(arcToggle).toHaveAttribute("aria-expanded", "true");
    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(result.items.find((item: { id: string }) => item.id === "c2-item").parentFolderId).toBe(
      "arc",
    );
    expect(localStorage.getItem("quiltor:binder:collapsed:arc")).toBe("false");
  });

  it("deletes only the folder metadata and keeps every descendant chapter", () => {
    const { onStructureChange } = renderBinder();
    const partRow = screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row")!;
    fireEvent.click(within(partRow).getByRole("button", { name: "Aktionen: Teil I" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Aktionen: Teil I" })).getByRole("menuitem", {
        name: "Ordner löschen; Inhalte bleiben erhalten",
      }),
    );

    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(result.folders.map((folder: { id: string }) => folder.id)).toEqual(["arc"]);
    expect(flattenChapterIds(result)).toEqual(["c1", "c2"]);
    expect(result.items.find((item: { id: string }) => item.id === "arc-item").parentFolderId).toBe(
      undefined,
    );
  });

  it("creates a sibling folder next to the active chapter", () => {
    const { onStructureChange } = renderBinder();
    fireEvent.click(screen.getByRole("button", { name: "Ordner hinzufügen" }));

    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(result.folders).toHaveLength(3);
    const added = result.folders.find((folder: { id: string }) => folder.id.startsWith("folder"));
    expect(added).toBeDefined();
    if (!added) throw new Error("new folder was not added");
    const item = result.items.find(
      (candidate: { folderId?: string }) => candidate.folderId === added.id,
    );
    expect(item.parentFolderId).toBe("arc");
  });

  it("makes the complete folder label a disclosure control and supports tree-like keyboard navigation", () => {
    renderBinder();

    const structure = screen.getByRole("list", { name: "Kapitelstruktur" });
    const part = within(structure).getByRole("button", {
      name: /Teil I, 1 Kapitel: Ordner einklappen/,
    });
    expect(part).toHaveAttribute("aria-expanded", "true");
    expect(part).toHaveAttribute("aria-controls", "binder-folder-children-part");

    fireEvent.keyDown(part, { key: "ArrowLeft" });
    expect(part).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ankunftsbogen")).not.toBeInTheDocument();

    fireEvent.keyDown(part, { key: "ArrowRight" });
    const nestedFolder = screen.getByRole("button", { name: /Ankunftsbogen, 1 Kapitel/ });
    part.focus();
    fireEvent.keyDown(part, { key: "ArrowDown" });
    expect(nestedFolder).toHaveFocus();
  });

  it("marks every visible tree row with its structural depth", () => {
    renderBinder();

    const partRow = screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row");
    const arcRow = screen.getByText("Ankunftsbogen").closest<HTMLElement>(".binder-folder-row");
    const nestedChapter = screen
      .getByText("Teil I / Ankunftsbogen")
      .closest<HTMLElement>(".binder-chapter-row");
    const rootChapter = screen.getByRole("button", { name: /Aufbruch/ });

    expect(partRow).toHaveAttribute("data-binder-depth", "0");
    expect(arcRow).toHaveAttribute("data-binder-depth", "1");
    expect(nestedChapter).toHaveAttribute("data-binder-depth", "2");
    expect(rootChapter).toHaveAttribute("data-binder-depth", "0");
  });

  it("keeps long folder names available and explains an expanded empty folder", () => {
    const longTitle = "Ein außergewöhnlich langer Ordnername für den vollständigen zweiten Akt";
    const manuscript: Manuscript = {
      ...nestedManuscript,
      structure: {
        folders: [...nestedManuscript.structure!.folders, { id: "empty", title: longTitle }],
        items: [
          ...nestedManuscript.structure!.items,
          { id: "empty-item", kind: "folder", folderId: "empty", position: 2 },
        ],
      },
    };
    renderBinder(vi.fn(), manuscript);

    const folder = screen.getByRole("button", {
      name: `${longTitle}, 0 Kapitel: Ordner einklappen`,
    });
    expect(folder).toHaveAttribute("title", longTitle);
    expect(folder).toHaveAccessibleName(/0 Kapitel/);
    expect(screen.getByText("Dieser Ordner ist leer.")).toBeVisible();
  });

  it("renames a folder through an explicit keyboard-confirmable edit state", async () => {
    const onStructureChange = vi.fn();
    renderBinder(onStructureChange);
    const partRow = screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row")!;

    fireEvent.click(within(partRow).getByRole("button", { name: "Aktionen: Teil I" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Aktionen: Teil I" })).getByRole("menuitem", {
        name: "Ordner umbenennen",
      }),
    );
    const input = await within(partRow).findByRole("textbox", { name: "Ordnername" });
    expect(input).toHaveValue("Teil I");
    fireEvent.change(input, { target: { value: "Erster Akt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const result = onStructureChange.mock.calls.at(-1)?.[0];
    expect(result.folders.find((folder: { id: string }) => folder.id === "part").title).toBe(
      "Erster Akt",
    );
  });

  it("locks the folder row to an explicit, responsive grid contract", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterFolderTree.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.binder-folder-row\s*\{[^}]*grid-template-columns:\s*var\(--space-24\) minmax\(0, 1fr\) auto;[^}]*grid-template-areas:\s*"drag main actions";/s,
    );
    expect(css).toMatch(
      /\.binder-drop-before\.is-visible\s*\{[^}]*height:\s*15px;[^}]*margin-block:\s*calc\(var\(--space-6\) \* -1\);/s,
    );
    expect(css).toMatch(
      /\.binder-root-drop\.is-visible\s*\{[^}]*min-height:\s*var\(--control-touch\)/s,
    );
    expect(css).toMatch(
      /\.binder-root-drop\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*var\(--space-8\);/s,
    );
    expect(css).toMatch(/\.binder-folder-toggle\s*\{[^}]*grid-area:\s*main;[^}]*width:\s*100%;/s);
    expect(css).not.toMatch(/\.binder-folder-action\s*\{[^}]*(?:width|height):/s);
    expect(css).toMatch(/\.binder-folder-direct-actions\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-folder-direct-actions\s*\{[^}]*display:\s*flex;[\s\S]*?\.binder-folder-more\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("uses real row indentation plus connected guides for nested hierarchy", () => {
    const treeCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterFolderTree.css"),
      "utf8",
    );
    const chapterCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterBinder.css"),
      "utf8",
    );

    expect(treeCss).toMatch(
      /\.binder-tree\s*\{[^}]*--binder-level-step:\s*var\(--space-12\);[^}]*--binder-indent-max:\s*var\(--space-48\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-row\s*\{[^}]*width:\s*calc\(100% - var\(--binder-indent\)\);[^}]*margin-inline-start:\s*var\(--binder-indent\);/s,
    );
    expect(chapterCss).toMatch(
      /\.binder-chapter-row\s*\{[^}]*width:\s*calc\(100% - var\(--binder-indent\)\);[^}]*margin-inline-start:\s*var\(--binder-indent\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-children::before\s*\{[^}]*background:\s*var\(--line-strong\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-children > \.binder-tree-entry::before\s*\{[^}]*width:\s*var\(--space-6\);[^}]*border-top:/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-row:not\(\[data-binder-depth="0"\]\)\s*\{[^}]*border-inline-start-width:\s*var\(--space-2\);[^}]*border-inline-start-color:\s*var\(--gold-border\);/s,
    );
    expect(treeCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-tree\s*\{[^}]*--binder-level-step:\s*var\(--space-10\);[^}]*--binder-indent-max:\s*var\(--space-24\);/s,
    );
    expect(treeCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-drag-handle\s*\{[^}]*display:\s*none;[\s\S]*?\.binder-folder-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*grid-template-areas:\s*"main actions";/s,
    );
    expect(chapterCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-chapter-row\s*\{[^}]*grid-template-columns:\s*var\(--space-24\) minmax\(0, 1fr\);/s,
    );
  });
});
