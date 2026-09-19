import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diffVersion, type VersionDiffProjection } from "../history";
import {
  editorDecorationExtensions,
  setMarkDecorations,
  setVersionDiffDecorations,
} from "./editorDecorations";

const labels = {
  addedLabel: "Hinzugefügt",
  addedLineBreakLabel: "Zeilenumbruch hinzugefügt",
  removedLabel: "Entfernt",
  formattingAddedLabels: { bold: "Fett hinzugefügt", italic: "Kursiv hinzugefügt" },
  formattingRemovedLabels: { bold: "Fett entfernt", italic: "Kursiv entfernt" },
};
const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

function createView(doc: string, projection: VersionDiffProjection) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        editorDecorationExtensions,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: "0" }),
      ],
    }),
  });
  views.push(view);
  view.dispatch({ effects: setVersionDiffDecorations.of({ projection, ...labels }) });
  return view;
}

describe("Version diff decorations", () => {
  it("orders same-position and edge removals without adding their text to the document or clipboard", () => {
    const view = createView("Text", {
      changes: [
        { kind: "removed", at: 0, text: "Zuerst " },
        { kind: "removed", at: 0, text: "<img src=x> " },
        { kind: "added", from: 0, to: 4, text: "Text" },
        { kind: "removed", at: 4, text: " danach" },
      ],
      equalSpans: [],
      formattingChanges: [],
    });
    expect(
      [...view.dom.querySelectorAll(".version-diff-removed")].map((node) => node.textContent),
    ).toEqual(["Zuerst ", "<img src=x> ", " danach"]);
    expect(view.dom.querySelector(".version-diff-removed img")).toBeNull();
    expect(view.state.doc.toString()).toBe("Text");
    view.focus();
    view.dispatch({ selection: EditorSelection.range(0, 4) });
    const setData = vi.fn();
    fireEvent.copy(view.contentDOM, { clipboardData: { clearData: vi.fn(), setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "Text");
  });

  it("makes pure paragraph insertions and removals visible while preserving exact text", () => {
    const joined = "Er ging. Dann wartete er.";
    const split = "Er ging.\n\nDann wartete er.";
    const view = createView(split, diffVersion(joined, split));
    expect(view.state.doc.toString()).toBe(split);
    expect(view.dom.querySelector('[aria-label="Zeilenumbruch hinzugefügt"]')).not.toBeNull();
    expect(view.dom.querySelector(".version-diff-added")?.textContent).not.toContain("wartete");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: joined },
      effects: setVersionDiffDecorations.of({ projection: diffVersion(split, joined), ...labels }),
    });
    expect(view.state.doc.toString()).toBe(joined);
    expect(view.dom.querySelector(".version-diff-removed")?.textContent).toContain("↵");
    expect(view.dom.querySelector(".version-diff-removed")?.textContent).not.toContain("wartete");
  });

  it("layers formatting changes with real marks and clears only the version layer", () => {
    const marks = [{ from: 0, to: 4, kind: "italic" as const }];
    const view = createView("Text", diffVersion("Text", "Text", [], marks));
    view.dispatch({ effects: setMarkDecorations.of(marks) });
    expect(view.dom.querySelector(".text-italic")?.textContent).toBe("Text");
    expect(view.dom.querySelector(".version-diff-format-added")?.textContent).toBe("Text");
    expect(view.dom.querySelector(".version-diff-format-added")?.getAttribute("aria-label")).toBe(
      "Kursiv hinzugefügt",
    );
    expect(view.dom.querySelector(".version-diff-added, .version-diff-removed")).toBeNull();
    view.dispatch({ effects: setVersionDiffDecorations.of({ projection: null, ...labels }) });
    expect(view.dom.querySelector(".version-diff-format-added")).toBeNull();
    expect(view.dom.querySelector(".text-italic")?.textContent).toBe("Text");
    expect(view.state.doc.toString()).toBe("Text");
  });
});
