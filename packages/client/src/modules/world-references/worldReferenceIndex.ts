import type { WorkspaceTarget } from "../../shared";
import {
  chapterBreadcrumb,
  type Manuscript,
  manuscriptStructure,
  orderedChapters,
} from "../manuscript";
import type { FigureKind, FigureState } from "../story-world";
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
      chapter.title || labels.untitled,
      [breadcrumb, chapter.note || chapter.body.slice(0, 120)].filter(Boolean).join(" · "),
      [chapter.body, chapter.note, breadcrumb],
      "text",
    );
  });
  const nodes = figures.nodes.map((node) => {
    const isPlace = node.type === "ort";
    const target: WorldReferenceTarget = {
      kind: isPlace ? "place" : "entity",
      id: node.id,
    };
    return candidate(
      target,
      node.name,
      node.sub || node.label || labels.figureKind(node.type ?? "person"),
      [
        node.label ?? "",
        node.sub ?? "",
        node.type ?? "person",
        ...(node.aliases ?? []).map((alias) => alias.alias),
        ...Object.values(node.profile ?? {}).flatMap((value) =>
          typeof value === "string" ? [value] : [],
        ),
      ],
      isPlace ? "places" : "figures",
    );
  });
  const moments = (figures.timeline ?? []).map((moment) =>
    candidate(
      { kind: "timeline", id: moment.id },
      moment.title,
      moment.note || moment.date || labels.moment,
      [moment.note ?? "", moment.date ?? "", String(moment.time ?? "")],
      "timeline",
    ),
  );
  const boards = storyboards.map((board) =>
    candidate(
      { kind: "storyboard", id: board.id },
      board.title,
      board.detail ?? "",
      board.keywords ?? [],
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

export function workspaceTargetForReference(
  target: WorldReferenceTarget,
): WorkspaceTarget | undefined {
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
      // Storyboard becomes routable when TECH-012 adds the fifth workspace. Returning
      // no false text target prevents callers from opening an unrelated chapter today.
      return undefined;
  }
}

function candidate(
  target: WorldReferenceTarget,
  label: string,
  detail: string,
  keywords: string[],
  workspace: WorldReferenceCandidate["workspace"],
): WorldReferenceCandidate {
  return {
    id: worldReferenceKey(target),
    target,
    label,
    detail,
    keywords: keywords.filter(Boolean),
    workspace,
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
