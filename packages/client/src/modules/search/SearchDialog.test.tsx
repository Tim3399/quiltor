import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Manuscript } from "../manuscript";
import { SearchDialog } from "./SearchDialog";

const manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Nebel über dem Hafen. Nebel im Tor.", note: "" },
    { id: "c2", title: "Aufbruch", body: "Sie gehen in den Nebel.", note: "" },
  ],
};
const figures = { nodes: [], edges: [] };
const storyboards = {
  boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
  nodes: [],
  edges: [],
};

afterEach(cleanup);

function renderSearch(
  onSelect = vi.fn(),
  sourceManuscript: Manuscript = manuscript,
  onShowSetAside = vi.fn(),
  onOpenChapterTrash = vi.fn(),
) {
  const onWorkspace = vi.fn();
  render(
    <I18nProvider>
      <SearchDialog
        manuscript={sourceManuscript}
        figures={figures}
        storyboards={storyboards}
        onClose={vi.fn()}
        onWorkspace={onWorkspace}
        onSelect={onSelect}
        onCommand={vi.fn()}
        onShowSetAside={onShowSetAside}
        onOpenChapterTrash={onOpenChapterTrash}
      />
    </I18nProvider>,
  );
  return { onSelect, onWorkspace, onShowSetAside, onOpenChapterTrash };
}

describe("SearchDialog manuscript results", () => {
  it("shows matching passages and passes the exact first occurrence to the editor", () => {
    const { onSelect, onWorkspace } = renderSearch();
    fireEvent.change(screen.getByLabelText("Suchbegriff"), { target: { value: "Nebel" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("2 Treffer im Text");
    expect(options[0].querySelector("mark")).toHaveTextContent("Nebel");

    fireEvent.click(options[1]);
    expect(onWorkspace).toHaveBeenCalledWith("text");
    expect(onSelect).toHaveBeenCalledWith({
      workspace: "text",
      id: "c2",
      textSearch: { query: "Nebel", from: 17, to: 22 },
    });
  });

  it("cycles from the first result to the last with ArrowUp", () => {
    const { onSelect } = renderSearch();
    const input = screen.getByLabelText("Suchbegriff");
    fireEvent.change(input, { target: { value: "Nebel" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
  });

  it("opens storyboard results in the fifth workspace", () => {
    const { onSelect, onWorkspace } = renderSearch();
    fireEvent.change(screen.getByLabelText("Suchbegriff"), { target: { value: "Main" } });

    fireEvent.click(screen.getByRole("option", { name: /Main Storyboard/ }));
    expect(onWorkspace).toHaveBeenCalledWith("storyboard");
    expect(onSelect).toHaveBeenCalledWith({ workspace: "storyboard", id: "main-storyboard" });
  });

  it("labels set-aside results and offers explicit alternate views when trash is excluded", () => {
    const scopedManuscript: Manuscript = {
      chapters: [
        ...manuscript.chapters,
        {
          id: "aside",
          title: "Entwurf",
          body: "Zinnoberdrache",
          note: "",
          inBook: false,
        },
      ],
      trash: [
        {
          chapter: { id: "deleted", title: "Alt", body: "Saphirwal", note: "" },
          deletedAt: "2026-09-19T10:00:00Z",
          originalFolderPath: [],
          treeItem: { id: "chapter:deleted", kind: "chapter", chapterId: "deleted", position: 0 },
        },
      ],
    };
    const { onShowSetAside, onOpenChapterTrash } = renderSearch(vi.fn(), scopedManuscript);
    const input = screen.getByLabelText("Suchbegriff");
    fireEvent.change(input, { target: { value: "Zinnoberdrache" } });
    expect(screen.getByRole("option", { name: /Entwurf/ })).toHaveTextContent("Zurückgestellt");

    fireEvent.change(input, { target: { value: "Saphirwal" } });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zurückgestellte Kapitel anzeigen" }));
    fireEvent.click(screen.getByRole("button", { name: "Kapitel-Papierkorb öffnen" }));
    expect(onShowSetAside).toHaveBeenCalledOnce();
    expect(onOpenChapterTrash).toHaveBeenCalledOnce();
  });
});

describe("SearchDialog command rows", () => {
  it("names the shortcut where one exists instead of repeating the word command", () => {
    renderSearch();

    // Nine rows all used to carry the same second line. Only this one command really has
    // a keyboard shortcut today -- none is invented here.
    const gesichert = screen.getByRole("option", { name: /Sicherung öffnen/ });
    expect(gesichert.textContent).toMatch(/⇧⌘S|Strg\+Umschalt\+S/);

    const manuskript = screen.getByRole("option", { name: /Zum Manuskript wechseln/ });
    expect(manuskript.textContent).toContain("Ansicht");

    const verlauf = screen.getByRole("option", { name: /Verlauf öffnen/ });
    expect(verlauf.textContent).toContain("Aktion");
  });
});
