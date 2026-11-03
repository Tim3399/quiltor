import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManuscriptEditorHandle } from "./ManuscriptEditor";
import type { Chapter } from "./model";
import { useManuscriptSearch } from "./useManuscriptSearch";

afterEach(cleanup);

const chapters: Chapter[] = [
  { id: "first", title: "Erstes Kapitel", body: "", note: "" },
  { id: "second", title: "Zweites Kapitel", body: "", note: "" },
];

function SearchHarness({ targetRequestId }: { targetRequestId: number }) {
  const [currentId, setCurrentId] = useState("first");
  const editor = useRef<ManuscriptEditorHandle | null>(null);
  const current = chapters.find((chapter) => chapter.id === currentId);
  useManuscriptSearch({
    chapters,
    current,
    targetId: "first",
    targetRequestId,
    editor,
    onCurrentId: setCurrentId,
  });
  return (
    <div>
      <output aria-label="Aktuelles Kapitel">{currentId}</output>
      <button type="button" onClick={() => setCurrentId("second")}>
        Zweites Kapitel intern auswählen
      </button>
    </div>
  );
}

describe("useManuscriptSearch navigation", () => {
  it("reselects a repeated chapter target after an internal selection", () => {
    const view = render(<SearchHarness targetRequestId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Zweites Kapitel intern auswählen" }));
    expect(screen.getByLabelText("Aktuelles Kapitel")).toHaveTextContent("second");

    view.rerender(<SearchHarness targetRequestId={2} />);
    expect(screen.getByLabelText("Aktuelles Kapitel")).toHaveTextContent("first");
  });
});

describe("useManuscriptSearch results", () => {
  const harbour: Chapter[] = [
    { id: "first", title: "Erstes Kapitel", body: "Hafen und Hafen und Hafen", note: "" },
    { id: "second", title: "Zweites Kapitel", body: "Nichts", note: "" },
  ];
  const noEditor = { current: null };

  it("takes a requested text search as query and active match, and opens its chapter", () => {
    const onCurrentId = vi.fn();
    const { result } = renderHook(() =>
      useManuscriptSearch({
        chapters: harbour,
        current: harbour[1],
        targetId: "first",
        targetRequestId: 1,
        textSearch: { query: " Hafen ", from: 10, to: 15 },
        editor: noEditor,
        onCurrentId,
      }),
    );

    expect(result.current.query).toBe("Hafen");
    expect(result.current.activeIndex).toBe(1);
    expect(onCurrentId).toHaveBeenCalledWith("first");
  });

  it("opens the chapter again for a new text search on the same target", () => {
    const onCurrentId = vi.fn();
    let search = { query: "Hafen", from: 0, to: 5 };
    const { result, rerender } = renderHook(() =>
      useManuscriptSearch({
        chapters: harbour,
        current: harbour[0],
        targetId: "first",
        targetRequestId: 1,
        textSearch: search,
        editor: noEditor,
        onCurrentId,
      }),
    );
    onCurrentId.mockClear();

    search = { query: "Hafen", from: 10, to: 15 };
    rerender();

    expect(result.current.activeIndex).toBe(1);
    expect(onCurrentId).toHaveBeenCalledWith("first");
  });

  it("keeps the active match inside the results when they shrink", () => {
    const stableSearch = { query: "Hafen", from: 0, to: 5 };
    let chaptersNow = harbour;
    const { result, rerender } = renderHook(() =>
      useManuscriptSearch({
        chapters: chaptersNow,
        current: chaptersNow[0],
        editor: noEditor,
        onCurrentId: vi.fn(),
        targetId: "first",
        targetRequestId: 1,
        textSearch: stableSearch,
      }),
    );
    act(() => result.current.navigate(1));
    act(() => result.current.navigate(1));
    expect(result.current.activeIndex).toBe(2);

    chaptersNow = [{ ...harbour[0], body: "Hafen" }, harbour[1]];
    rerender();

    expect(result.current.matches).toHaveLength(1);
    expect(result.current.activeIndex).toBe(0);
  });
});
