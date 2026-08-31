import { describe, expect, it } from "vitest";
import {
  CARD_KINDS,
  cardKindClassName,
  cardKindColor,
  cardKindPresentation,
} from "./cardPresentation";

describe("card kind presentation", () => {
  it("owns an exhaustive class and token mapping", () => {
    const expected = {
      person: [
        "graph-card-kind--person",
        "var(--card-kind-person)",
        "var(--card-kind-person-surface)",
      ],
      tier: ["graph-card-kind--tier", "var(--card-kind-tier)", "var(--card-kind-tier-surface)"],
      ort: ["graph-card-kind--ort", "var(--card-kind-ort)", "var(--card-kind-ort-surface)"],
      organisation: [
        "graph-card-kind--organisation",
        "var(--card-kind-organisation)",
        "var(--card-kind-organisation-surface)",
      ],
      objekt: [
        "graph-card-kind--objekt",
        "var(--card-kind-objekt)",
        "var(--card-kind-objekt-surface)",
      ],
      konzept: [
        "graph-card-kind--konzept",
        "var(--card-kind-konzept)",
        "var(--card-kind-konzept-surface)",
      ],
      chapter: [
        "graph-card-kind--chapter",
        "var(--card-kind-chapter)",
        "var(--card-kind-chapter-surface)",
      ],
      timeline: [
        "graph-card-kind--timeline",
        "var(--card-kind-timeline)",
        "var(--card-kind-timeline-surface)",
      ],
      note: ["graph-card-kind--note", "var(--card-kind-note)", "var(--card-kind-note-surface)"],
      storyboard: [
        "graph-card-kind--storyboard",
        "var(--card-kind-storyboard)",
        "var(--card-kind-storyboard-surface)",
      ],
      group: ["graph-card-kind--group", "var(--card-kind-group)", "var(--card-kind-group-surface)"],
      reference: [
        "graph-card-kind--reference",
        "var(--card-kind-reference)",
        "var(--card-kind-reference-surface)",
      ],
    } as const;

    expect(CARD_KINDS).toHaveLength(12);
    for (const kind of CARD_KINDS) {
      const [className, color, surface] = expected[kind];
      expect(cardKindPresentation(kind)).toEqual({
        className,
        color,
        surface,
      });
      expect(cardKindClassName(kind)).toBe(`graph-card-kind ${className}`);
      expect(cardKindColor(kind)).toBe(color);
    }
  });
});
