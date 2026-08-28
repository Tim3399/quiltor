import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
