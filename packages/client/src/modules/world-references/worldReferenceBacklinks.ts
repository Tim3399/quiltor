import type { NoteReference, WorkspaceTarget } from "../../shared";
import {
  type Chapter,
  chapterBreadcrumb,
  type EntityMention,
  type Manuscript,
  manuscriptStructure,
  orderedChapters,
} from "../manuscript";
import type { FigureNode, FigureState, TimelineMoment } from "../story-world";
import type { StoryboardNode, StoryboardState } from "../storyboard";
import type {
  WorldReferenceBacklink,
  WorldReferenceBacklinkIndex,
  WorldReferenceBacklinkSource,
  WorldReferenceBacklinkSourceKind,
  WorldReferenceTarget,
} from "./model";
import { worldReferenceKey } from "./model";
import { workspaceTargetForReference } from "./worldReferenceIndex";

const EMPTY_BACKLINKS: readonly WorldReferenceBacklink[] = [];

export function buildWorldReferenceBacklinks({
  manuscript,
  figures,
  storyboards,
}: {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards?: StoryboardState;
}): WorldReferenceBacklinkIndex {
  const backlinks = new Map<string, WorldReferenceBacklink[]>();
  const nodesById = new Map(figures.nodes.map((node) => [node.id, node]));
  const structure = manuscriptStructure(manuscript);

  const append = (
    target: WorldReferenceTarget,
    source: WorldReferenceBacklinkSource,
    item: NoteReference | EntityMention,
  ) => {
    const canonicalTarget = canonicalEntityTarget(target, nodesById);
    const backlink: WorldReferenceBacklink = {
      id: JSON.stringify([source.kind, worldReferenceKey(source.target), item.id]),
      origin: "text",
      target: canonicalTarget,
      source,
      surface: item.surface,
      from: item.from,
      to: item.to,
    };
    const key = worldReferenceKey(canonicalTarget);
    backlinks.set(key, [...(backlinks.get(key) ?? []), backlink]);
  };

  for (const chapter of orderedChapters(manuscript)) {
    const detail = chapterBreadcrumb(structure, chapter.id)
      .map((folder) => folder.title)
      .join(" / ");
    for (const reference of inTextOrder(chapter.noteReferences ?? [])) {
      append(reference.target, chapterSource(chapter, detail, "chapter-note"), reference);
    }
    for (const mention of inTextOrder(chapter.mentions ?? [])) {
      append(
        { kind: "entity", id: mention.elementId },
        chapterSource(chapter, detail, "chapter-mention"),
        mention,
      );
    }
  }

  for (const node of figures.nodes) {
    const sourceTarget = targetForNode(node);
    const kind: WorldReferenceBacklinkSourceKind =
      sourceTarget.kind === "place" ? "place-note" : "entity-note";
    const source: WorldReferenceBacklinkSource = {
      target: sourceTarget,
      workspace: sourceTarget.kind === "place" ? "places" : "figures",
      label: node.name.trim() || node.id,
      detail: node.sub || node.label || node.type || "",
      kind,
    };
    for (const reference of inTextOrder(node.profile?.noteReferences ?? [])) {
      append(reference.target, source, reference);
    }
  }

  for (const moment of figures.timeline ?? []) {
    const source = timelineSource(moment);
    for (const reference of inTextOrder(moment.noteReferences ?? [])) {
      append(reference.target, source, reference);
    }
  }

  if (storyboards) {
    for (const board of storyboards.boards) {
      for (const node of storyboards.nodes) {
        if (node.boardId !== board.id) continue;
        const source = storyboardSource(node, board.title, "storyboard-note");
        for (const reference of inTextOrder(node.noteReferences ?? [])) {
          append(reference.target, source, reference);
        }
        if (node.kind !== "reference" && node.kind !== "storyboard") continue;
        const canonicalTarget = canonicalEntityTarget(node.target, nodesById);
        const cardSource = storyboardSource(node, board.title, "storyboard-reference");
        const backlink: WorldReferenceBacklink = {
          id: JSON.stringify([cardSource.kind, worldReferenceKey(cardSource.target)]),
          origin: "card",
          target: canonicalTarget,
          source: cardSource,
        };
        const key = worldReferenceKey(canonicalTarget);
        backlinks.set(key, [...(backlinks.get(key) ?? []), backlink]);
      }
    }
  }

  return backlinks;
}

/** Opens a backlink's owner and pinpoints manuscript mentions when body coordinates are known. */
export function workspaceTargetForBacklink(
  backlink: WorldReferenceBacklink,
): WorkspaceTarget | undefined {
  const target = workspaceTargetForReference(backlink.source.target);
  if (!target || backlink.source.kind !== "chapter-mention" || backlink.origin !== "text") {
    return target;
  }
  return {
    ...target,
    textSearch: {
      query: backlink.surface,
      from: backlink.from,
      to: backlink.to,
    },
  };
}

/** Resolves stale entity/place kinds by their shared stable node ID. */
export function backlinksForWorldReference(
  index: WorldReferenceBacklinkIndex,
  target: WorldReferenceTarget,
): readonly WorldReferenceBacklink[] {
  const exact = index.get(worldReferenceKey(target));
  if (exact || (target.kind !== "entity" && target.kind !== "place")) {
    return exact ?? EMPTY_BACKLINKS;
  }
  const alternate: WorldReferenceTarget = {
    kind: target.kind === "entity" ? "place" : "entity",
    id: target.id,
  };
  return index.get(worldReferenceKey(alternate)) ?? EMPTY_BACKLINKS;
}

function chapterSource(
  chapter: Chapter,
  detail: string,
  kind: "chapter-note" | "chapter-mention",
): WorldReferenceBacklinkSource {
  return {
    target: { kind: "chapter", id: chapter.id },
    workspace: "text",
    label: chapter.title.trim() || chapter.id,
    detail,
    kind,
  };
}

function timelineSource(moment: TimelineMoment): WorldReferenceBacklinkSource {
  return {
    target: { kind: "timeline", id: moment.id },
    workspace: "timeline",
    label: moment.title.trim() || moment.id,
    detail: moment.date || moment.note || "",
    kind: "timeline-note",
  };
}

function storyboardSource(
  node: StoryboardNode,
  boardTitle: string,
  kind: "storyboard-note" | "storyboard-reference",
): WorldReferenceBacklinkSource {
  return {
    target: { kind: "storyboard", id: node.id },
    workspace: "storyboard",
    label: (node.label?.trim() || node.text?.trim() || node.id).replace(/\s+/g, " ").slice(0, 80),
    detail: boardTitle.trim(),
    kind,
    boardId: node.boardId,
    nodeId: node.id,
  };
}

function targetForNode(node: FigureNode): WorldReferenceTarget {
  return { kind: node.type === "ort" ? "place" : "entity", id: node.id };
}

function canonicalEntityTarget(
  target: WorldReferenceTarget,
  nodesById: ReadonlyMap<string, FigureNode>,
): WorldReferenceTarget {
  if (target.kind !== "entity" && target.kind !== "place") return target;
  const node = nodesById.get(target.id);
  return node ? targetForNode(node) : target;
}

function inTextOrder<T extends { from: number; to: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        left.item.from - right.item.from ||
        left.item.to - right.item.to ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
