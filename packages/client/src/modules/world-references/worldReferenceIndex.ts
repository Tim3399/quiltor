import { normalizeNoteReferenceSurface, type WorkspaceTarget } from "../../shared";
import {
  chapterBreadcrumb,
  type Manuscript,
  manuscriptStructure,
  orderedChapters,
} from "../manuscript";
import { type FigureKind, type FigureState, normalizeProfile } from "../story-world";
import type {
  StoryboardReferenceSource,
  WorldReferenceCandidate,
  WorldReferenceTarget,
} from "./model";
import { worldReferenceKey } from "./model";

export interface WorldReferenceIndexLabels {
  untitled: string;
  moment: string;
  figureKind: (kind: FigureKind) => string;
}

export function buildWorldReferenceCandidates({
  manuscript,
  figures,
  storyboards = [],
  labels,
}: {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards?: StoryboardReferenceSource[];
  labels: WorldReferenceIndexLabels;
}): WorldReferenceCandidate[] {
  const structure = manuscriptStructure(manuscript);
  const chapters = orderedChapters(manuscript).map((chapter) => {
    const breadcrumb = chapterBreadcrumb(structure, chapter.id)
      .map((folder) => folder.title)
      .join(" / ");
    return candidate(
      { kind: "chapter", id: chapter.id },
      chapter.title.trim() || labels.untitled,
      [breadcrumb, chapter.note || chapter.body.slice(0, 120)].filter(Boolean).join(" · "),
      [chapter.body, chapter.note, breadcrumb],
      "text",
      "chapter",
    );
  });
  const nodes = figures.nodes.map((node) => {
    const isPlace = node.type === "ort";
    const profile = normalizeProfile(node.profile || {}, node.id);
    const target: WorldReferenceTarget = {
      kind: isPlace ? "place" : "entity",
      id: node.id,
    };
    return candidate(
      target,
      node.name.trim() || labels.figureKind(node.type ?? "person"),
      node.sub || node.label || labels.figureKind(node.type ?? "person"),
      [
        node.label ?? "",
        node.sub ?? "",
        node.type ?? "person",
        ...(node.aliases ?? []).map((alias) => alias.alias),
        profile.notizen ?? "",
        ...(profile.fields ?? []).flatMap((field) => [field.key, field.value]),
      ],
      isPlace ? "places" : "figures",
      node.type ?? "person",
    );
  });
  const moments = (figures.timeline ?? []).map((moment) =>
    candidate(
      { kind: "timeline", id: moment.id },
      moment.title.trim() || labels.moment,
      moment.note || moment.date || labels.moment,
      [moment.note ?? "", moment.date ?? "", String(moment.time ?? "")],
      "timeline",
      "timeline",
    ),
  );
  const boards = storyboards.map((board) =>
    candidate(
      { kind: "storyboard", id: board.id },
      board.title.trim() || labels.untitled,
      board.detail ?? "",
      board.keywords ?? [],
      "storyboard",
      "storyboard",
    ),
  );
  return [...chapters, ...nodes, ...moments, ...boards];
}

export function searchWorldReferences(
  candidates: readonly WorldReferenceCandidate[],
  query: string,
  limit = 50,
) {
  const needle = normalizeSearchText(query.trim());
  if (!needle) return candidates.slice(0, limit);
  const tokens = needle.split(/\s+/).filter(Boolean);
  return candidates
    .map((item, index) => ({ item, index, score: candidateScore(item, needle, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function workspaceTargetForReference(target: WorldReferenceTarget): WorkspaceTarget {
  switch (target.kind) {
    case "chapter":
      return { workspace: "text", id: target.id };
    case "place":
      return { workspace: "places", id: target.id };
    case "timeline":
      return { workspace: "timeline", id: target.id };
    case "entity":
      return { workspace: "figures", id: target.id };
    case "storyboard":
      return { workspace: "storyboard", id: target.id };
  }
}

/**
 * Resolves a stored target against the live index. Figure and place references share a node ID,
 * so a later type change may legitimately move that ID between their two workspaces.
 */
export function resolveWorldReferenceCandidate(
  candidates: readonly WorldReferenceCandidate[],
  target: WorldReferenceTarget,
) {
  const exact = candidates.find(
    (item) => worldReferenceKey(item.target) === worldReferenceKey(target),
  );
  if (exact || (target.kind !== "entity" && target.kind !== "place")) return exact;
  return candidates.find(
    (item) =>
      (item.target.kind === "entity" || item.target.kind === "place") &&
      item.target.id === target.id,
  );
}

function candidate(
  target: WorldReferenceTarget,
  label: string,
  detail: string,
  keywords: string[],
  workspace: WorldReferenceCandidate["workspace"],
  cardKind: WorldReferenceCandidate["cardKind"],
): WorldReferenceCandidate {
  return {
    id: worldReferenceKey(target),
    target,
    label: normalizeNoteReferenceSurface(label),
    detail,
    keywords: keywords.filter(Boolean),
    workspace,
    cardKind,
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase();
}

function candidateScore(item: WorldReferenceCandidate, needle: string, tokens: string[]) {
  const label = normalizeSearchText(item.label);
  const detail = normalizeSearchText(item.detail);
  const keywords = item.keywords.map(normalizeSearchText);
  const haystack = [label, detail, ...keywords];
  if (!tokens.every((token) => haystack.some((value) => value.includes(token)))) return 0;
  if (label === needle) return 1000;
  if (label.startsWith(needle)) return 850;
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 750;
  if (label.includes(needle)) return 650;
  if (detail.includes(needle)) return 450;
  if (keywords.some((value) => value.includes(needle))) return 300;
  return 100 + tokens.length;
}
