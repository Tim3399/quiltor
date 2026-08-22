import type { ChangeSet } from "@codemirror/state";
import type { TextMark, TextMarkKind } from "./model";

export const MARK_KINDS: TextMarkKind[] = ["bold", "italic"];

/** Sorted, clamped, non-overlapping: touching or overlapping ranges of one kind become one. */
export function normalizeMarks(marks: TextMark[] = [], length = Infinity): TextMark[] {
  const result: TextMark[] = [];
  for (const kind of MARK_KINDS) {
    const ranges = marks
      .filter((mark) => mark.kind === kind)
      .map((mark) => ({
        kind,
        from: Math.max(0, Math.min(mark.from, length)),
        to: Math.max(0, Math.min(mark.to, length)),
      }))
      .filter((mark) => mark.to > mark.from)
      .sort((a, b) => a.from - b.from || a.to - b.to);
    for (const range of ranges) {
      const previous = result.at(-1);
      // Adjacency merges too (`previous.to === range.from`): bolding two halves of a word
      // one after the other is one bold word, not two ranges that happen to touch.
      if (previous && previous.kind === kind && range.from <= previous.to)
        previous.to = Math.max(previous.to, range.to);
      else result.push(range);
    }
  }
  return result.sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
}

/** True when every character of [from, to) already carries this kind. */
export function hasMark(
  marks: TextMark[] = [],
  from: number,
  to: number,
  kind: TextMarkKind,
): boolean {
  if (to <= from) return false;
  let covered = from;
  for (const mark of normalizeMarks(marks).filter((item) => item.kind === kind)) {
    if (mark.from > covered) break;
    covered = Math.max(covered, mark.to);
    if (covered >= to) return true;
  }
  return false;
}

/**
 * Bold on an already-bold passage takes the bold away; on anything else it applies it.
 * Overlapping and adjacent ranges of the same kind merge instead of piling up duplicates.
 */
export function toggleMark(
  marks: TextMark[] = [],
  from: number,
  to: number,
  kind: TextMarkKind,
): TextMark[] {
  if (to <= from) return normalizeMarks(marks);
  const others = marks.filter((mark) => mark.kind !== kind);
  const same = normalizeMarks(marks, Infinity).filter((mark) => mark.kind === kind);
  if (hasMark(same, from, to, kind)) {
    const remaining = same.flatMap((mark) => [
      { kind, from: mark.from, to: Math.min(mark.to, from) },
      { kind, from: Math.max(mark.from, to), to: mark.to },
    ]);
    return normalizeMarks([...others, ...remaining]);
  }
  return normalizeMarks([...others, ...same, { kind, from, to }]);
}

/** Marks follow the text they sit on: the same job mapMentions does for mentions. */
export function mapMarks(marks: TextMark[] = [], changes: ChangeSet, length: number): TextMark[] {
  return normalizeMarks(
    marks.map((mark) => ({
      ...mark,
      from: changes.mapPos(mark.from, 1),
      to: changes.mapPos(mark.to, -1),
    })),
    length,
  );
}

/**
 * Marks after a replacement made outside the editor -- renaming an entity rewrites the body
 * directly (replaceEntityMentions), and formatting has to travel with it just as it does
 * through a keystroke. A mark that sat on the replaced words keeps sitting on them.
 */
export function marksAfterReplacement(
  marks: TextMark[] = [],
  from: number,
  to: number,
  insertedLength: number,
  bodyLength: number,
): TextMark[] {
  const delta = insertedLength - (to - from);
  const start = (position: number) =>
    position <= from ? position : position >= to ? position + delta : from;
  const end = (position: number) =>
    position <= from ? position : position >= to ? position + delta : from + insertedLength;
  return normalizeMarks(
    marks.map((mark) => ({ ...mark, from: start(mark.from), to: end(mark.to) })),
    bodyLength,
  );
}

export type MarkedSegment = { text: string; bold: boolean; italic: boolean };

/**
 * The slice [from, from + text.length) of the body, cut into runs of equal formatting.
 * The marks index the whole body, so a paragraph passes its own start offset.
 */
export function markedSegments(
  text: string,
  from: number,
  marks: TextMark[] = [],
): MarkedSegment[] {
  const relevant = normalizeMarks(marks).filter(
    (mark) => mark.to > from && mark.from < from + text.length,
  );
  if (!relevant.length) return text ? [{ text, bold: false, italic: false }] : [];
  const boundaries = new Set([0, text.length]);
  for (const mark of relevant) {
    boundaries.add(Math.max(0, mark.from - from));
    boundaries.add(Math.min(text.length, mark.to - from));
  }
  const cuts = [...boundaries].sort((a, b) => a - b);
  const segments: MarkedSegment[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const start = cuts[index],
      end = cuts[index + 1];
    if (end <= start) continue;
    const carries = (kind: TextMarkKind) =>
      relevant.some(
        (mark) => mark.kind === kind && mark.from <= from + start && mark.to >= from + end,
      );
    const segment = {
      text: text.slice(start, end),
      bold: carries("bold"),
      italic: carries("italic"),
    };
    const previous = segments.at(-1);
    if (previous && previous.bold === segment.bold && previous.italic === segment.italic)
      previous.text += segment.text;
    else segments.push(segment);
  }
  return segments;
}

/** The paragraphs the book PDF prints, each with its offset into the untrimmed body. */
export function bodyParagraphs(body: string): Array<{ text: string; from: number }> {
  const lead = body.length - body.trimStart().length;
  const trimmed = body.trim();
  const paragraphs: Array<{ text: string; from: number }> = [];
  let start = 0;
  for (const match of trimmed.matchAll(/\n{2,}/g)) {
    paragraphs.push({ text: trimmed.slice(start, match.index), from: lead + start });
    start = match.index + match[0].length;
  }
  paragraphs.push({ text: trimmed.slice(start), from: lead + start });
  return paragraphs.filter((paragraph) => paragraph.text);
}

// On the way out Markdown is the format, so there the markers are right: the reader of an
// exported file sees *kursiv*, not a range table. Emphasis cannot span a blank line and
// must not have its delimiters against whitespace, so a run is split and trimmed first.
function emphasize(text: string, bold: boolean, italic: boolean): string {
  if (!bold && !italic) return text;
  const open = `${bold ? "**" : ""}${italic ? "*" : ""}`,
    close = `${italic ? "*" : ""}${bold ? "**" : ""}`;
  return text
    .split(/(\n\s*\n)/)
    .map((piece) => {
      if (!piece.trim() || /^\n\s*\n$/.test(piece)) return piece;
      const lead = piece.slice(0, piece.length - piece.trimStart().length);
      const tail = piece.slice(piece.trimEnd().length);
      return `${lead}${open}${piece.trim()}${close}${tail}`;
    })
    .join("");
}

/** The chapter body as Markdown: the ranges become `**bold**` and `*italic*`. */
export function markdownBody(body: string, marks: TextMark[] = []): string {
  const segments = markedSegments(body, 0, marks);
  if (!segments.length) return body;
  return segments.map((segment) => emphasize(segment.text, segment.bold, segment.italic)).join("");
}
