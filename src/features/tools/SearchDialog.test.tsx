import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../language";
import { SearchDialog } from "./SearchDialog";

const manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Nebel über dem Hafen. Nebel im Tor.", note: "" },
    { id: "c2", title: "Aufbruch", body: "Sie gehen in den Nebel.", note: "" },
  ],
};
const figures = { nodes: [], edges: [] };

afterEach(cleanup);

function renderSearch(onSelect = vi.fn()) {
  const onWorkspace = vi.fn();
  render(
    <LanguageProvider>
      <SearchDialog
        manuscript={manuscript}
        figures={figures}
        onClose={vi.fn()}
        onWorkspace={onWorkspace}
        onSelect={onSelect}
        onCommand={vi.fn()}
      />
    </LanguageProvider>,
  );
  return { onSelect, onWorkspace };
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
});
