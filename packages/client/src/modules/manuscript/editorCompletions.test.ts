import { describe, expect, it } from "vitest";
import type { FigureNode } from "../story-world";
import { suggestEditorCompletion } from "./editorCompletions";

const figure: FigureNode = {
  id: "tarek",
  x: 0,
  y: 0,
  type: "person",
  name: "Tarek",
  sub: "Bäcker",
};

describe("editor completion preview", () => {
  it("attaches the figure and its presentation detail to an entity suggestion", () => {
    const completion = suggestEditorCompletion("Tarke", 5, [figure], [], (entity) =>
      String(entity.sub),
    );

    expect(completion).toMatchObject({
      word: "Tarek",
      start: 0,
      end: 5,
      entity: figure,
      detail: "Bäcker",
    });
  });

  it("falls back to the manuscript vocabulary without inventing entity metadata", () => {
    expect(suggestEditorCompletion("Sch", 3, [], ["Schimmer"], () => "unused")).toEqual({
      word: "Schimmer",
      start: 0,
      end: 3,
    });
  });
});
