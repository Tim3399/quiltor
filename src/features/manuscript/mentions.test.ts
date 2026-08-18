import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { EntityMention, FigureNode } from "../../types";
import {
  addDeterministicMentions,
  mapMentions,
  reconcileMentions,
  replaceEntityMentions,
  scanEntityMentions,
} from "./mentions";

const node = (id: string, name: string): FigureNode => ({ id, name, x: 0, y: 0, type: "person" });

describe("entity mentions", () => {
  it("uses exact boundaries, umlauts and longest matches without overlap", () => {
    const result = scanEntityMentions(
      "Ann trifft Anna-Lena in Köln. Kölnisch bleibt frei.",
      [node("ann", "Ann"), node("anna", "Anna-Lena"), node("koeln", "Köln")],
      () => "mention",
    );
    expect(result.mentions.map((item) => [item.elementId, item.surface])).toEqual([
      ["ann", "Ann"],
      ["anna", "Anna-Lena"],
      ["koeln", "Köln"],
    ]);
  });

  it("reports identical names as ambiguous and never applies them", () => {
    const result = scanEntityMentions("Mara wartet.", [node("a", "Mara"), node("b", "Mara")]);
    expect(result.mentions).toEqual([]);
    expect(result.ambiguous[0]).toMatchObject({ surface: "Mara", elementIds: ["a", "b"] });
  });

  it("maps edits before mentions and removes links edited within them", () => {
    const mention: EntityMention = {
      id: "m",
      elementId: "n",
      from: 4,
      to: 8,
      surface: "Mara",
      source: "deterministic",
      confidence: 1,
    };
    const before = ChangeSet.of({ from: 0, insert: "Oh " }, 9),
      text = "Oh Die Mara";
    expect(mapMentions([mention], before, text)[0]).toMatchObject({ from: 7, to: 11 });
    const inside = ChangeSet.of({ from: 6, to: 7, insert: "o" }, 9);
    expect(mapMentions([mention], inside, "Die Maro.")).toEqual([]);
  });

  it("removes orphaned and surface-invalid links while counting them", () => {
    const result = reconcileMentions(
      {
        chapters: [
          {
            id: "c",
            title: "",
            note: "",
            body: "Mara",
            mentions: [
              {
                id: "ok",
                elementId: "mara",
                from: 0,
                to: 4,
                surface: "Mara",
                source: "helper",
                confidence: 1,
              },
              {
                id: "bad",
                elementId: "gone",
                from: 0,
                to: 4,
                surface: "Mara",
                source: "helper",
                confidence: 1,
              },
            ],
          },
        ],
      },
      [node("mara", "Mara")],
    );
    expect(result.orphanedCount).toBe(1);
    expect(result.manuscript.chapters[0].mentions).toHaveLength(1);
  });

  it("adds only non-overlapping deterministic links to existing mentions", () => {
    const existing: EntityMention = {
      id: "manual",
      elementId: "chosen",
      from: 0,
      to: 4,
      surface: "Mara",
      source: "helper",
      confidence: 1,
    };
    const result = addDeterministicMentions(
      "Mara und Bela",
      [existing],
      [node("mara", "Mara"), node("bela", "Bela")],
    );
    expect(result.map((item) => item.elementId)).toEqual(["chosen", "bela"]);
  });

  it("replaces linked surfaces in reverse order and keeps other offsets valid", () => {
    const manuscript = {
      chapters: [
        {
          id: "c",
          title: "",
          note: "",
          body: "Mara trifft Mara und Bela",
          mentions: [
            {
              id: "m1",
              elementId: "mara",
              from: 0,
              to: 4,
              surface: "Mara",
              source: "helper" as const,
              confidence: 1,
            },
            {
              id: "m2",
              elementId: "mara",
              from: 12,
              to: 16,
              surface: "Mara",
              source: "helper" as const,
              confidence: 1,
            },
            {
              id: "b",
              elementId: "bela",
              from: 21,
              to: 25,
              surface: "Bela",
              source: "helper" as const,
              confidence: 1,
            },
          ],
        },
      ],
    };
    const result = replaceEntityMentions(manuscript, "mara", "Maralena").chapters[0];
    expect(result.body).toBe("Maralena trifft Maralena und Bela");
    expect(result.mentions?.map((item) => [item.surface, item.from, item.to])).toEqual([
      ["Maralena", 0, 8],
      ["Maralena", 16, 24],
      ["Bela", 29, 33],
    ]);
  });
});
