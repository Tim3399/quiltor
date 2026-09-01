import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import { replyReferences, resolveAssistantMessage } from "./formatting";
import type { AssistantReply } from "./model";

const baseReply = (patch: Partial<AssistantReply> = {}): AssistantReply => ({
  ok: true,
  message: "Free-form fallback",
  proposals: [],
  sources: [],
  ...patch,
});

describe("assistant reply formatting", () => {
  it("resolves deterministic message items and notes through i18n", () => {
    const t: Translate = (key, params) => {
      if (key === "assistantGreetingBody") return `Items: ${params?.items ?? ""}`;
      return `translated:${key}`;
    };

    expect(
      resolveAssistantMessage(
        baseReply({
          messageKey: "assistantGreetingBody",
          messageItems: [{ key: "findMissingFigures" }, { key: "checkTimeline" }],
          messageNoteKey: "manuscriptReadOnlyNote",
        }),
        t,
      ),
    ).toBe(
      "Items: translated:findMissingFigures; translated:checkTimeline\n\ntranslated:manuscriptReadOnlyNote",
    );
  });

  it("deduplicates source and proposal targets for machine-readable history", () => {
    expect(
      replyReferences(
        baseReply({
          sources: [
            {
              id: "element:tarek",
              kind: "element",
              contextClass: "canon",
              title: "Tarek",
              text: "",
              target: { workspace: "figures", id: "tarek" },
            },
          ],
          proposals: [
            {
              kind: "set_presence",
              elementId: "element:tarek",
              placeId: "element:burg",
              momentId: "moment:1",
            },
            {
              kind: "create_relationship",
              relationship: { from: "element:tarek", to: "element:igor" },
            },
          ],
        }),
      ),
    ).toEqual(["element:tarek", "element:burg", "moment:1", "element:igor"]);
  });
});
