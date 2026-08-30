import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidePanel } from "../../design";
import { flattenChapterIds } from "./binder/manuscriptTree";
import { ChapterBinder } from "./ChapterBinder";
import type { Manuscript } from "./model";
import { requireValue, TestProviders } from "./TextWorkspace.testSupport";

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
  onExportCurrent = vi.fn(),
  onRequestDelete = vi.fn(),
) {
  return {
    onStructureChange,
    onSelect,
    onExportCurrent,
    onRequestDelete,
    ...render(
      <TestProviders>
        <SidePanel className="manuscript-binder-panel" label="Kapitel" side="start">
          <ChapterBinder
            manuscript={manuscript}
            current={manuscript.chapters[0]}
            totalWords={6}
            viewportMode="wide"
            onClose={vi.fn()}
            onSelect={onSelect}
            onStructureChange={onStructureChange}
            onUpdateCurrent={vi.fn()}
            onExportCurrent={onExportCurrent}
            onRequestDelete={onRequestDelete}
          />
        </SidePanel>
      </TestProviders>,
    ),
  };
}

describe("ChapterBinder folders", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("keeps one quiet, keyboard-accessible action menu attached to the active chapter", async () => {
    const onExport = vi.fn();
    const onDelete = vi.fn();
    renderBinder(vi.fn(), nestedManuscript, vi.fn(), onExport, onDelete);

    const activeRow = requireValue(
      screen
        .getByText("Ankunft", { selector: ".chapter-name" })
        .closest<HTMLElement>(".binder-chapter-row"),
      "Active chapter row missing",
    );
    const trigger = within(activeRow).getByRole("button", {
      name: "Kapitelaktionen: Ankunft",
    });
    expect(activeRow).toHaveClass("has-actions");
    const inactiveRow = requireValue(
      screen
        .getByText("Aufbruch", { selector: ".chapter-name" })
        .closest<HTMLElement>(".binder-chapter-row"),
      "Inactive chapter row missing",
    );
    expect(inactiveRow).not.toHaveClass("has-actions");
    expect(screen.queryByRole("toolbar", { name: "Kapitelaktionen: Ankunft" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Kapitelaktionen:/ })).toEqual([trigger]);
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Kapitelaktionen: Ankunft" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Nach oben", "Nach unten", "Kapitel als Markdown", "Kapitel löschen"]);
    expect(within(menu).getByRole("menuitem", { name: "Nach oben" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Nach unten" })).toBeDisabled();
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
    expect(within(menu).getByRole("menuitem", { name: "Kapitel löschen" })).toHaveAttribute(
      "data-tone",
      "danger",
    );

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Kapitel als Markdown" }));
    expect(onExport).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(
      within(await screen.findByRole("menu", { name: "Kapitelaktionen: Ankunft" })).getByRole(
        "menuitem",
        { name: "Kapitel löschen" },
      ),
    );
    expect(onDelete).toHaveBeenCalledOnce();

    const chapterCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterBinder.css"),
      "utf8",
    );
    const actionsCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterActionsMenu.css"),
      "utf8",
    );
    expect(chapterCss).toMatch(
      /\.binder-chapter-row\s*\{[^}]*grid-template-columns:\s*16px minmax\(0, 1fr\) auto;[^}]*grid-template-areas:\s*"drag main actions";/s,
    );
    expect(chapterCss).toMatch(
      /\.binder-chapter-content\s*\{[^}]*grid-template-areas:\s*"number name" "number meta";/s,
    );
    expect(chapterCss).toMatch(/\.binder-chapter-select\s*\{[^}]*justify-content:\s*stretch;/s);
    expect(chapterCss).toMatch(
      /\.binder-chapter-content\s*\{[^}]*padding-inline-start:\s*var\(--space-16\);/s,
    );
    expect(chapterCss).toMatch(
      /\.binder-chapter-row\[data-binder-depth="0"\] \.binder-chapter-content\s*\{[^}]*padding-inline-start:\s*var\(--space-24\);/s,
    );
    expect(chapterCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-chapter-row\[data-binder-depth="0"\] \.binder-chapter-content\s*\{[^}]*padding-inline-start:\s*var\(--space-20\);/s,
    );
    expect(actionsCss).toMatch(
      /\.binder-chapter-action-trigger\s*\{[^}]*grid-area:\s*actions;[^}]*opacity:\s*0\.72;/s,
    );
    expect(chapterCss).not.toContain("binder-chapter-toolbar");
  });

  it("links folder action triggers to a keyboard menu and marks deletion as dangerous", async () => {
    renderBinder();
    const partRow = requireValue(
      screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row"),
      "Part row missing",
    );
    const trigger = within(partRow).getByRole("button", { name: "Aktionen: Teil I" });

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const menu = await screen.findByRole("menu", { name: "Aktionen: Teil I" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(within(menu).getByRole("separator")).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", {
        name: "Ordner löschen; Inhalte bleiben erhalten",
      }),
    ).toHaveAttribute("data-tone", "danger");

    const rename = within(menu).getByRole("menuitem", { name: "Ordner umbenennen" });
    await waitFor(() => expect(rename).toHaveFocus());
    fireEvent.keyDown(rename, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("moves the active chapter from its contextual menu", async () => {
    const manuscript: Manuscript = {
      chapters: [
        { id: "a", title: "Alpha", body: "", note: "" },
        { id: "b", title: "Beta", body: "", note: "" },
      ],
    };
    const onStructureChange = vi.fn();
    renderBinder(onStructureChange, manuscript);

    fireEvent.click(screen.getByRole("button", { name: "Kapitelaktionen: Alpha" }));
    const menu = await screen.findByRole("menu", { name: "Kapitelaktionen: Alpha" });
    expect(within(menu).getByRole("menuitem", { name: "Nach oben" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Nach unten" })).toBeEnabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Nach unten" }));

    expect(flattenChapterIds(onStructureChange.mock.calls.at(-1)?.[0])).toEqual(["b", "a"]);
  });

  it("renders arbitrary nesting without repeating the folder path and persists collapse", () => {
    renderBinder();

    const chapterRow = requireValue(
      screen
        .getByText("Ankunft", { selector: ".chapter-name" })
        .closest<HTMLElement>(".binder-chapter-row"),
      "Nested chapter row missing",
    );
    expect(chapterRow).not.toHaveTextContent("Teil I / Ankunftsbogen");
    fireEvent.click(screen.getAllByRole("button", { name: /Ordner einklappen/ })[0]);
    expect(screen.queryByText("Ankunftsbogen")).not.toBeInTheDocument();
    expect(localStorage.getItem("quiltor:binder:collapsed:part")).toBe("true");
  });

  it("moves a root chapter into a nested folder through the visible drop target", () => {
    const { onStructureChange, container } = renderBinder();
    const chapter = screen.getByRole("button", { name: /Aufbruch/ });
    const folder = requireValue(
      screen.getByText("Ankunftsbogen").closest(".binder-folder-row"),
      "Nested folder row missing",
    );

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
    const partRow = requireValue(
      screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row"),
      "Part row missing",
    );
    const toggle = within(partRow).getByRole("button", { name: /Teil I, 1 Kapitel/ });
    const handle = requireValue(
      partRow.querySelector<HTMLElement>('.binder-drag-handle[draggable="true"]'),
      "Part drag handle missing",
    );
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

  it("keeps the chapter drag handle functional beside the selection and action controls", () => {
    renderBinder();
    const row = requireValue(
      screen
        .getByText("Ankunft", { selector: ".chapter-name" })
        .closest<HTMLElement>(".binder-chapter-row"),
      "Chapter row missing",
    );
    const select = within(row).getByRole("button", { current: "page" });
    const action = within(row).getByRole("button", { name: "Kapitelaktionen: Ankunft" });
    const handle = requireValue(
      row.querySelector<HTMLElement>('.binder-drag-handle[draggable="true"]'),
      "Chapter drag handle missing",
    );
    const transfer = createDataTransfer();

    expect(select).not.toContainElement(action);
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe("move");
    expect(transfer.setData).toHaveBeenCalledWith("application/x-quiltor-binder-item", "c1-item");
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
    const alpha = requireValue(
      screen.getByText("Alpha", { selector: ".chapter-name" }).closest<HTMLButtonElement>("button"),
      "Alpha selection missing",
    );
    const gamma = requireValue(
      screen.getByText("Gamma", { selector: ".chapter-name" }).closest<HTMLButtonElement>("button"),
      "Gamma selection missing",
    );
    const alphaRow = requireValue(
      alpha.closest<HTMLElement>(".binder-chapter-row"),
      "Alpha row missing",
    );
    vi.spyOn(alphaRow, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 144,
      height: 44,
    } as DOMRect);

    let transfer = createDataTransfer();
    fireEvent.dragStart(gamma, { dataTransfer: transfer });
    const dragOverAfter = createEvent.dragOver(alphaRow, { dataTransfer: transfer });
    Object.defineProperty(dragOverAfter, "clientY", { value: 140 });
    fireEvent(alphaRow, dragOverAfter);
    expect(alphaRow).toHaveAttribute("data-drop-position", "after");
    const dropAfter = createEvent.drop(alphaRow, { dataTransfer: transfer });
    Object.defineProperty(dropAfter, "clientY", { value: 140 });
    fireEvent(alphaRow, dropAfter);
    expect(flattenChapterIds(onStructureChange.mock.calls.at(-1)?.[0])).toEqual(["a", "c", "b"]);

    onStructureChange.mockClear();
    transfer = createDataTransfer();
    fireEvent.dragStart(gamma, { dataTransfer: transfer });
    const alphaEntry = requireValue(
      alpha.closest<HTMLElement>(".binder-tree-entry"),
      "Alpha tree entry missing",
    );
    const before = requireValue(
      alphaEntry.querySelector<HTMLElement>(":scope > .binder-drop-before"),
      "Alpha drop target missing",
    );
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
    const partRow = requireValue(
      screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row"),
      "Part row missing",
    );
    const arcRow = requireValue(
      screen.getByText("Ankunftsbogen").closest<HTMLElement>(".binder-folder-row"),
      "Arc row missing",
    );
    const partHandle = requireValue(
      partRow.querySelector<HTMLElement>('.binder-drag-handle[draggable="true"]'),
      "Part drag handle missing",
    );

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
    const partRow = requireValue(
      screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row"),
      "Part row missing",
    );
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
      .getByText("Ankunft", { selector: ".chapter-name" })
      .closest<HTMLElement>(".binder-chapter-row");
    const rootChapter = screen
      .getByRole("button", { name: /Aufbruch/ })
      .closest<HTMLElement>(".binder-chapter-row");

    expect(partRow).toHaveAttribute("data-binder-depth", "0");
    expect(arcRow).toHaveAttribute("data-binder-depth", "1");
    expect(nestedChapter).toHaveAttribute("data-binder-depth", "2");
    expect(rootChapter).toHaveAttribute("data-binder-depth", "0");

    const partEntry = partRow?.closest<HTMLElement>(".binder-tree-entry");
    const arcEntry = arcRow?.closest<HTMLElement>(".binder-tree-entry");
    const chapterEntry = nestedChapter?.closest<HTMLElement>(".binder-tree-entry");
    expect(partRow?.parentElement).toBe(partEntry);
    expect(arcRow?.parentElement).toBe(arcEntry);
    expect(nestedChapter?.parentElement).toBe(chapterEntry);
    expect(arcEntry?.parentElement).toHaveClass("binder-folder-children");
    expect(arcEntry?.parentElement?.closest(".binder-tree-entry")).toBe(partEntry);
    expect(chapterEntry?.parentElement?.closest(".binder-tree-entry")).toBe(arcEntry);
  });

  it("keeps long folder names available and explains an expanded empty folder", () => {
    const longTitle = "Ein außergewöhnlich langer Ordnername für den vollständigen zweiten Akt";
    const nestedStructure = requireValue(nestedManuscript.structure, "Nested structure missing");
    const manuscript: Manuscript = {
      ...nestedManuscript,
      structure: {
        folders: [...nestedStructure.folders, { id: "empty", title: longTitle }],
        items: [
          ...nestedStructure.items,
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
    const partRow = requireValue(
      screen.getByText("Teil I").closest<HTMLElement>(".binder-folder-row"),
      "Part row missing",
    );

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

  it("uses recursive list indentation plus connected guides for every nested hierarchy", () => {
    const treeCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterFolderTree.css"),
      "utf8",
    );
    const chapterCss = readFileSync(
      join(process.cwd(), "packages/client/src/modules/manuscript/ChapterBinder.css"),
      "utf8",
    );

    expect(treeCss).toMatch(/\.binder-tree\s*\{[^}]*--binder-level-step:\s*var\(--space-20\);/s);
    expect(treeCss).toMatch(/\.binder-folder-row\s*\{[^}]*width:\s*100%;/s);
    expect(chapterCss).toMatch(/\.binder-chapter-row\s*\{[^}]*width:\s*100%;/s);
    expect(chapterCss).toMatch(
      /\.binder-chapter-row\s*\{[^}]*border:\s*1px solid var\(--transparent\);[^}]*border-inline-start-color:\s*var\(--line\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-children\s*\{[^}]*padding-inline-start:\s*var\(--binder-level-step\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-children::before\s*\{[^}]*inset-inline-start:\s*var\(--space-6\);[^}]*background:\s*var\(--line-strong\);/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-children > \.binder-tree-entry::before\s*\{[^}]*inset-inline-start:\s*calc\(\(var\(--binder-level-step\) - var\(--space-6\)\) \* -1\);[^}]*width:\s*calc\(var\(--binder-level-step\) - var\(--space-6\)\);[^}]*border-top:/s,
    );
    expect(treeCss).toMatch(
      /\.binder-folder-row:not\(\[data-binder-depth="0"\]\)\s*\{[^}]*border-inline-start-width:\s*var\(--space-2\);[^}]*border-inline-start-color:\s*var\(--accent-primary-border\);/s,
    );
    expect(treeCss).not.toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-tree\s*\{[^}]*--binder-level-step:/s,
    );
    expect(treeCss).not.toContain("--binder-indent-max");
    expect(treeCss).not.toContain("--binder-indent");
    expect(treeCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-drag-handle\s*\{[^}]*display:\s*none;[\s\S]*?\.binder-folder-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*grid-template-areas:\s*"main actions";/s,
    );
    expect(chapterCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.binder-chapter-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"main";[\s\S]*?\.binder-chapter-row\.has-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--control-touch\);[^}]*grid-template-areas:\s*"main actions";/s,
    );
  });
});
