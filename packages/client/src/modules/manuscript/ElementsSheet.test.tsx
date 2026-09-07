import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { FigureState } from "../story-world";
import { ElementsSheet } from "./ElementsSheet";
import type { Manuscript } from "./model";

const figures: FigureState = {
  nodes: [
    { id: "mara", x: 0, y: 0, type: "person", name: "Mara Venn" },
    { id: "archiv", x: 0, y: 0, type: "ort", name: "Gezeitenarchiv" },
  ],
  edges: [],
};

afterEach(cleanup);

function renderSheet(manuscript: Manuscript, onChange = vi.fn()) {
  render(
    <I18nProvider>
      <ElementsSheet
        open
        manuscript={manuscript}
        figures={figures}
        onChange={onChange}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  return { onChange };
}

const leer: Manuscript = { chapters: [] };

describe("ElementsSheet", () => {
  it("bietet zunaechst jedes Element an", () => {
    renderSheet(leer);

    expect(screen.getByRole("button", { name: /Mara Venn wird angeboten/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("merkt sich das Abgewaehlte, nicht das Ausgewaehlte", () => {
    const { onChange } = renderSheet(leer);

    fireEvent.click(screen.getByRole("button", { name: /Mara Venn wird angeboten/ }));

    // Nur die eine Id: eine Figur, die spaeter angelegt wird, soll von selbst erscheinen.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hiddenElements: ["mara"] }));
  });

  it("nimmt ein Element wieder auf", () => {
    const { onChange } = renderSheet({ chapters: [], hiddenElements: ["mara", "archiv"] });

    fireEvent.click(screen.getByRole("button", { name: /Mara Venn wird nicht angeboten/ }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hiddenElements: ["archiv"] }));
  });

  it("laesst die Welt in Ruhe -- ausgeblendet ist nicht geloescht", () => {
    const { onChange } = renderSheet(leer);

    fireEvent.click(screen.getByRole("button", { name: /Gezeitenarchiv/ }));

    expect(figures.nodes).toHaveLength(2);
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("nodes");
  });
});
