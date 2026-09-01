import { describe, expect, it } from "vitest";
import { decodeAssistantReplyV1, type AssistantReplyWireV1 } from "./assistant";

describe("assistant wire v1", () => {
  it("preserves Storyboard planning provenance and its card target", () => {
    const wire: AssistantReplyWireV1 = {
      ok: true,
      message: "Planning context found.",
      proposals: [],
      contextClassesUsed: ["canon", "planning"],
      sources: [
        {
          id: "storyboard:turning-point",
          kind: "storyboard",
          contextClass: "planning",
          title: "Turning point",
          text: "Possible turn",
          target: {
            workspace: "storyboard",
            id: "turning-point",
            boardId: "plot-board",
          },
        },
      ],
    };

    expect(decodeAssistantReplyV1(wire).sources).toEqual([
      expect.objectContaining({
        contextClass: "planning",
        target: {
          workspace: "storyboard",
          id: "turning-point",
          boardId: "plot-board",
        },
      }),
    ]);
    expect(decodeAssistantReplyV1(wire).contextClassesUsed).toEqual(["canon", "planning"]);
  });
});
