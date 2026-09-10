import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { figures, renderWorkspace } from "./TextWorkspace.testSupport";

vi.mock("./BookDocument", () => ({
  BookDocument: ({ onReady }: { onReady?: (pages: unknown[]) => void }) => {
    const ready = useRef(onReady);
    useEffect(() => {
      ready.current?.([
        { number: 1, blank: false, chapterStart: false },
        { number: 2, chapterId: "c1", blank: false, chapterStart: true },
        { number: 3, chapterId: "c2", blank: false, chapterStart: true },
      ]);
    }, []);
    return (
      <div className="print-document" data-book-ready="true">
        <div className="pagedjs_pages">
          <div className="pagedjs_page" data-page-number="1" />
          <div
            className="pagedjs_page"
            data-page-number="2"
            data-chapter-id="c1"
            data-chapter-start="true"
          />
          <div
            className="pagedjs_page"
            data-page-number="3"
            data-chapter-id="c2"
            data-chapter-start="true"
          />
        </div>
      </div>
    );
  },
}));

afterEach(cleanup);

it("keeps the editor mounted and its chapter frozen while preview binder navigation changes", async () => {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  const onFocus = vi.fn();
  renderWorkspace({
    manuscript: {
      chapters: [
        { id: "c1", title: "Prolog", body: "Erster Text", note: "" },
        { id: "c2", title: "Kapitel Zwei", body: "Zweiter Text", note: "" },
      ],
    },
    figures,
    onChange: vi.fn(),
    focus: true,
    onFocus,
    viewportMode: "wide",
    binderOpen: true,
    inspectorOpen: true,
  });

  const editor = screen.getByRole("textbox", { name: "Kapiteltext" });
  fireEvent.click(screen.getByRole("button", { name: "Druckansicht" }));
  expect(onFocus).toHaveBeenCalledWith(false);
  expect(editor).toBeInTheDocument();
  expect(editor.closest(".text-editor-preserved")).toHaveAttribute("inert");
  expect(screen.getByText("Buchsatz")).toBeInTheDocument();

  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  const binder = screen.getByLabelText("Kapitel");
  fireEvent.click(within(binder).getByText("Prolog"));
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getByText("Kapitel Zwei"));
  expect(screen.getByDisplayValue("Prolog")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Druckansicht" }));
  expect(editor.closest(".text-editor-preserved")).not.toHaveAttribute("inert");
  await waitFor(() => expect(editor).toHaveFocus());
});
