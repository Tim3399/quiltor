import type { ChangeSet } from "@codemirror/state";
import type { FigureNode } from "../story-world";
import type { Chapter, EntityMention, Manuscript } from "./model";
import { marksAfterReplacement } from "./marks";

export type AmbiguousMentionCandidate = {
  from: number;
  to: number;
  surface: string;
  elementIds: string[];
};

const wordCharacter = /[\p{L}\p{N}_]/u;
const boundary = (text: string, from: number, to: number) =>
  (!from || !wordCharacter.test(text[from - 1])) &&
  (to === text.length || !wordCharacter.test(text[to]));

export function scanEntityMentions(
  text: string,
  nodes: FigureNode[],
  idFactory: () => string = () => crypto.randomUUID(),
) {
  const groups = new Map<string, FigureNode[]>();
  for (const node of nodes) {
    const name = node.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("de-DE");
    groups.set(key, [...(groups.get(key) || []), node]);
  }
  const names = [...groups.keys()].sort(
    (a, b) => b.length - a.length || a.localeCompare(b, "de-DE"),
  );
  const folded = text.toLocaleLowerCase("de-DE"),
    occupied: Array<[number, number]> = [];
  const mentions: EntityMention[] = [],
    ambiguous: AmbiguousMentionCandidate[] = [];
  for (const name of names) {
    let from = 0;
    while ((from = folded.indexOf(name, from)) >= 0) {
      const to = from + name.length;
      const overlaps = occupied.some(([start, end]) => from < end && to > start);
      if (!overlaps && boundary(text, from, to)) {
        const matches = groups.get(name)!;
        occupied.push([from, to]);
        if (matches.length === 1)
          mentions.push({
            id: idFactory(),
            elementId: matches[0].id,
            from,
            to,
            surface: text.slice(from, to),
            source: "deterministic",
            confidence: 1,
          });
        else
          ambiguous.push({
            from,
            to,
            surface: text.slice(from, to),
            elementIds: matches.map((node) => node.id),
          });
      }
      from = Math.max(to, from + 1);
    }
  }
  mentions.sort((a, b) => a.from - b.from || b.to - a.to);
  ambiguous.sort((a, b) => a.from - b.from || b.to - a.to);
  return { mentions, ambiguous };
}

export function mapMentions(mentions: EntityMention[], changes: ChangeSet, text: string) {
  return mentions.flatMap((mention) => {
    let editedInside = false;
    changes.iterChanges((from, to) => {
      if (
        (from < mention.to && to > mention.from) ||
        (from === to && from > mention.from && from < mention.to)
      )
        editedInside = true;
    });
    if (editedInside) return [];
    const from = changes.mapPos(mention.from, 1),
      to = changes.mapPos(mention.to, -1);
    return text.slice(from, to) === mention.surface ? [{ ...mention, from, to }] : [];
  });
}

export function reconcileMentions(manuscript: Manuscript, nodes: FigureNode[]) {
  const known = new Set(nodes.map((node) => node.id));
  let orphanedCount = 0;
  const chapters: Chapter[] = manuscript.chapters.map((chapter) => {
    const mentions = (chapter.mentions || []).filter((mention) => {
      const valid =
        known.has(mention.elementId) &&
        mention.from >= 0 &&
        mention.to <= chapter.body.length &&
        mention.from < mention.to &&
        chapter.body.slice(mention.from, mention.to) === mention.surface;
      if (!valid) orphanedCount += 1;
      return valid;
    });
    return mentions.length || chapter.mentions ? { ...chapter, mentions } : chapter;
  });
  return { manuscript: { ...manuscript, chapters }, orphanedCount };
}

export function addDeterministicMentions(
  text: string,
  existing: EntityMention[],
  nodes: FigureNode[],
) {
  const scanned = scanEntityMentions(text, nodes).mentions;
  const additions = scanned.filter(
    (candidate) =>
      !existing.some((mention) => candidate.from < mention.to && candidate.to > mention.from),
  );
  return [...existing, ...additions].sort((a, b) => a.from - b.from || b.to - a.to);
}

export function replaceEntityMentions(
  manuscript: Manuscript,
  elementId: string,
  replacement: string,
): Manuscript {
  return {
    ...manuscript,
    chapters: manuscript.chapters.map((chapter) => {
      const targets = (chapter.mentions || [])
        .filter((mention) => mention.elementId === elementId)
        .sort((a, b) => b.from - a.from);
      if (!targets.length) return chapter;
      let body = chapter.body,
        mentions = chapter.mentions || [],
        marks = chapter.marks;
      for (const target of targets) {
        const delta = replacement.length - (target.to - target.from);
        body = body.slice(0, target.from) + replacement + body.slice(target.to);
        mentions = mentions.map((mention) =>
          mention.id === target.id
            ? { ...mention, to: mention.from + replacement.length, surface: replacement }
            : mention.from >= target.to
              ? { ...mention, from: mention.from + delta, to: mention.to + delta }
              : mention,
        );
        // A rename rewrites the body behind the editor's back, so bold and italic have to be
        // carried over here too -- otherwise they would point at the wrong words, or past the
        // end of the text, and the backend would refuse the save.
        if (marks?.length)
          marks = marksAfterReplacement(
            marks,
            target.from,
            target.to,
            replacement.length,
            body.length,
          );
      }
      return {
        ...chapter,
        body,
        mentions: mentions.sort((a, b) => a.from - b.from),
        ...(marks ? { marks } : {}),
      };
    }),
  };
}
