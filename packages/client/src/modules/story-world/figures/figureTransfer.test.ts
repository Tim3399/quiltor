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
    expect(parseFigureState(serializeFigureState(state))).toEqual(state);
  });

  it("rejects JSON that is not a figure diagram", () => {
    expect(() => parseFigureState('{"nodes":[]}')).toThrow();
    expect(() => parseFigureState("not json")).toThrow();
  });

  it("keeps profile and custom fields in the Markdown export", () => {
    expect(serializeFigureProfiles(state, t)).toContain(
      "# Ada\n\n*Hauptfigur*\nKartografin\n\n## profileAge\n\n31\n\n## Geheimnis\n\nKennt den Weg",
    );
  });
});
