import type { CardKind } from "../graph";
import type { WorldReferenceCandidate } from "../world-references";

/** The order of the kinds in the element library: the manuscript first, then the world. */
const LIBRARY_KIND_ORDER: readonly CardKind[] = [
  "chapter",
  "person",
  "tier",
  "ort",
  "organisation",
  "objekt",
  "konzept",
  "timeline",
  "storyboard",
];

export interface LibraryGroup {
  kind: CardKind;
  candidates: WorldReferenceCandidate[];
}

/**
 * Sorts search results into one group per kind. A group exists only while it has an entry;
 * inside a group the incoming order (relevance, then index) is kept.
 */
export function groupLibraryCandidates(
  candidates: readonly WorldReferenceCandidate[],
): LibraryGroup[] {
  const byKind = new Map<CardKind, WorldReferenceCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byKind.get(candidate.cardKind);
    if (bucket) bucket.push(candidate);
    else byKind.set(candidate.cardKind, [candidate]);
  }
  const known = LIBRARY_KIND_ORDER.filter((kind) => byKind.has(kind));
  const unknown = [...byKind.keys()].filter((kind) => !LIBRARY_KIND_ORDER.includes(kind));
  return [...known, ...unknown].map((kind) => ({ kind, candidates: byKind.get(kind) ?? [] }));
}
