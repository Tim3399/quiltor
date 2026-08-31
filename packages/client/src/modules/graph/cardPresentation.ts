import "./cardPresentation.css";

/**
 * Stable semantic kinds for every draggable card that can appear in a Quiltor graph.
 *
 * The value is deliberately independent from persistence models. Features translate
 * their domain objects into this contract, while this module remains the single owner
 * of the visual type-to-token mapping.
 */
export const CARD_KINDS = [
  "person",
  "tier",
  "ort",
  "organisation",
  "objekt",
  "konzept",
  "chapter",
  "timeline",
  "note",
  "storyboard",
  "group",
  "reference",
] as const;

export type CardKind = (typeof CARD_KINDS)[number];

export interface CardKindPresentation {
  className: `graph-card-kind--${CardKind}`;
  color: string;
  surface: string;
}

/*
 * Keep token names explicit so the design gate can verify every referenced
 * custom property against colors.css. This also makes the mapping auditable.
 */
const CARD_KIND_PRESENTATIONS = {
  person: {
    className: "graph-card-kind--person",
    color: "var(--card-kind-person)",
    surface: "var(--card-kind-person-surface)",
  },
  tier: {
    className: "graph-card-kind--tier",
    color: "var(--card-kind-tier)",
    surface: "var(--card-kind-tier-surface)",
  },
  ort: {
    className: "graph-card-kind--ort",
    color: "var(--card-kind-ort)",
    surface: "var(--card-kind-ort-surface)",
  },
  organisation: {
    className: "graph-card-kind--organisation",
    color: "var(--card-kind-organisation)",
    surface: "var(--card-kind-organisation-surface)",
  },
  objekt: {
    className: "graph-card-kind--objekt",
    color: "var(--card-kind-objekt)",
    surface: "var(--card-kind-objekt-surface)",
  },
  konzept: {
    className: "graph-card-kind--konzept",
    color: "var(--card-kind-konzept)",
    surface: "var(--card-kind-konzept-surface)",
  },
  chapter: {
    className: "graph-card-kind--chapter",
    color: "var(--card-kind-chapter)",
    surface: "var(--card-kind-chapter-surface)",
  },
  timeline: {
    className: "graph-card-kind--timeline",
    color: "var(--card-kind-timeline)",
    surface: "var(--card-kind-timeline-surface)",
  },
  note: {
    className: "graph-card-kind--note",
    color: "var(--card-kind-note)",
    surface: "var(--card-kind-note-surface)",
  },
  storyboard: {
    className: "graph-card-kind--storyboard",
    color: "var(--card-kind-storyboard)",
    surface: "var(--card-kind-storyboard-surface)",
  },
  group: {
    className: "graph-card-kind--group",
    color: "var(--card-kind-group)",
    surface: "var(--card-kind-group-surface)",
  },
  reference: {
    className: "graph-card-kind--reference",
    color: "var(--card-kind-reference)",
    surface: "var(--card-kind-reference-surface)",
  },
} satisfies Record<CardKind, CardKindPresentation>;

export function cardKindPresentation(kind: CardKind): CardKindPresentation {
  return CARD_KIND_PRESENTATIONS[kind];
}

export function cardKindClassName(kind: CardKind) {
  return `graph-card-kind ${cardKindPresentation(kind).className}`;
}

export function cardKindColor(kind: CardKind) {
  return cardKindPresentation(kind).color;
}
