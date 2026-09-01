import { describe, expect, it } from "vitest";
import type { Translate } from "../../../i18n";
import type { FigureState } from "../model";
import { parseFigureState, serializeFigureProfiles, serializeFigureState } from "./figureTransfer";

const state: FigureState = {
  nodes: [
    {
      id: "ada",
      x: 12,
      y: 24,
      name: "Ada",
      label: "Hauptfigur",
      sub: "Kartografin",
      profile: { alter: "31", extra: [{ k: "Geheimnis", v: "Kennt den Weg" }] },
    },
  ],
  edges: [],
};
const t = ((key: string) => (key === "untitled" ? "Ohne Titel" : key)) as Translate;

describe("figure transfer", () => {
  it("round-trips the complete diagram JSON", () => {
    expect(parseFigureState(serializeFigureState(state))).toEqual({
      ...state,
      nodes: [
        {
          ...state.nodes[0],
          profile: {
            fields: [
              { id: "profile-field:ada:legacy:alter", key: "Alter", value: "31" },
              {
                id: "profile-field:ada:extra:0",
                key: "Geheimnis",
                value: "Kennt den Weg",
              },
            ],
          },
        },
      ],
    });
  });

  it("round-trips note formatting and rejects malformed imported ranges", () => {
    const formatted: FigureState = {
      nodes: [
        {
          id: "mara",
          x: 0,
          y: 0,
          name: "Mara",
          profile: {
            notizen: "Titel\nMara",
            noteMarks: [
              { from: 0, to: 5, kind: "heading", level: 2 },
              { from: 6, to: 10, kind: "bold" },
            ],
            fields: [],
          },
        },
      ],
      edges: [],
    };
    expect(parseFigureState(serializeFigureState(formatted))).toEqual(formatted);

    const invalid = JSON.parse(serializeFigureState(formatted));
    invalid.nodes[0].profile.noteMarks[0].to = 10;
    expect(() => parseFigureState(JSON.stringify(invalid))).toThrow(
      "Invalid figure note formatting",
    );

    const invalidTimeline = {
      nodes: [],
      edges: [],
      timeline: [{ id: "storm", note: "Kurz", noteMarks: [{ from: 0, to: 99, kind: "italic" }] }],
    };
    expect(() => parseFigureState(JSON.stringify(invalidTimeline))).toThrow(
      "Invalid figure note formatting",
    );
  });

  it("rejects JSON that is not a figure diagram", () => {
    expect(() => parseFigureState('{"nodes":[]}')).toThrow();
    expect(() => parseFigureState("not json")).toThrow();
    expect(() =>
      parseFigureState('{"nodes":[{"id":"ada","profile":{"fields":null}}],"edges":[]}'),
    ).toThrow("Invalid figure profile fields");
    expect(() =>
      parseFigureState(
        '{"nodes":[{"id":"ada","profile":{"fields":[{"id":"same","key":"A","value":"1"},{"id":"same","key":"B","value":"2"}]}}],"edges":[]}',
      ),
    ).toThrow("Invalid figure profile field");
    expect(() =>
      parseFigureState(
        '{"nodes":[{"id":"ada","profile":{"fields":[],"extra":[{"k":null,"v":"x"}]}}],"edges":[]}',
      ),
    ).toThrow("Invalid legacy figure profile fields");
  });

  it("keeps profile and custom fields in the Markdown export", () => {
    expect(serializeFigureProfiles(state, t)).toContain(
      "# Ada\n\n*Hauptfigur*\nKartografin\n\n## profileAge\n\n31\n\n## Geheimnis\n\nKennt den Weg",
    );
  });

  it("exports notes before canonical flexible fields", () => {
    const markdown = serializeFigureProfiles(
      {
        nodes: [
          {
            id: "mara",
            x: 0,
            y: 0,
            name: "Mara",
            profile: {
              notizen: "Vertraut dem Archiv.",
              fields: [{ id: "role", key: "Aufgabe", value: "Archivarin" }],
            },
          },
        ],
        edges: [],
      },
      t,
    );

    expect(markdown).toContain("## profileNotes\n\nVertraut dem Archiv.");
    expect(markdown.indexOf("## profileNotes")).toBeLessThan(markdown.indexOf("## Aufgabe"));
  });

  it("exports note emphasis and headings as nested Markdown", () => {
    const markdown = serializeFigureProfiles(
      {
        nodes: [
          {
            id: "mara",
            x: 0,
            y: 0,
            name: "Mara",
            profile: {
              notizen: "Plan\nArchivarin",
              noteMarks: [
                { from: 0, to: 4, kind: "heading", level: 1 },
                { from: 5, to: 15, kind: "bold" },
                { from: 5, to: 15, kind: "italic" },
              ],
              fields: [],
            },
          },
        ],
        edges: [],
      },
      t,
    );

    expect(markdown).toContain("## profileNotes\n\n### Plan\n***Archivarin***");
  });
});
