import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FocusPanels } from "./FocusPanels";
import type { Manuscript } from "./model";

afterEach(cleanup);

const manuscript: Manuscript = {
  chapters: [{ id: "one", title: "Eins", body: "Text", note: "" }],
};

function panels(focus: boolean) {
  return (
    <I18nProvider>
      <FocusPanels
        focus={focus}
        manuscript={manuscript}
        figures={{ nodes: [], edges: [] }}
        current={manuscript.chapters[0]}
        onSelectChapter={vi.fn()}
        onInsertEntity={vi.fn()}
        onInsert={vi.fn()}
        onFocusEditor={vi.fn()}
        onLeave={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("FocusPanels", () => {
  it("closes the helper panel when focus mode is left, so it is closed on the next entry", () => {
    const view = render(panels(true));
    fireEvent.click(screen.getByRole("button", { name: "Details öffnen" }));
    expect(screen.getByRole("button", { name: "Details schließen" })).toBeInTheDocument();

    view.rerender(panels(false));
    view.rerender(panels(true));

    expect(screen.getByRole("button", { name: "Details öffnen" })).toBeInTheDocument();
  });
});
