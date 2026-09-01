import type { ChangeSet } from "@codemirror/state";
import type { NoteHeadingLevel, NoteMark } from "../../shared";

function inlineMarks(marks: readonly NoteMark[], kind: "bold" | "italic", length: number) {
  return marks
    .filter((mark): mark is Extract<NoteMark, { kind: typeof kind }> => mark.kind === kind)
    .map((mark) => ({
      ...mark,
      kind,
      from: Math.max(0, Math.min(mark.from, length)),
      to: Math.max(0, Math.min(mark.to, length)),
    }))
    .filter((mark) => mark.to > mark.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function lineRanges(text: string, from: number, to: number) {
  const safeFrom = Math.max(0, Math.min(from, text.length));
  const safeTo = Math.max(safeFrom, Math.min(to, text.length));
  const firstStart = text.lastIndexOf("\n", Math.max(0, safeFrom - 1)) + 1;
  const ranges: Array<{ from: number; to: number }> = [];
  let start = firstStart;
  const selectionEnd = safeTo > safeFrom && text[safeTo - 1] === "\n" ? safeTo - 1 : safeTo;
  while (start <= selectionEnd) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    if (end > start) ranges.push({ from: start, to: end });
    if (newline < 0 || newline >= selectionEnd) break;
    start = newline + 1;
  }
  return ranges;
}

/** Canonical ranges keep the note text plain and make persisted formatting deterministic. */
export function normalizeNoteMarks(text: string, marks: readonly NoteMark[] = []): NoteMark[] {
  const headings = new Map<number, Extract<NoteMark, { kind: "heading" }>>();
  for (const mark of marks) {
    if (mark.kind !== "heading" || ![1, 2, 3].includes(mark.level)) continue;
    for (const line of lineRanges(text, mark.from, mark.to)) {
      headings.set(line.from, { ...mark, ...line, kind: "heading", level: mark.level });
    }
  }
  return [
    ...inlineMarks(marks, "bold", text.length),
    ...inlineMarks(marks, "italic", text.length),
    ...headings.values(),
  ].sort(
    (left, right) =>
      left.from - right.from || left.to - right.to || left.kind.localeCompare(right.kind),
  );
}

function fullyCovered(
  marks: readonly NoteMark[],
  from: number,
  to: number,
  kind: "bold" | "italic",
) {
  let covered = from;
  for (const mark of normalizeNoteMarks(" ".repeat(Math.max(to, 0)), marks)) {
    if (mark.kind !== kind) continue;
    if (mark.from > covered) break;
    covered = Math.max(covered, mark.to);
    if (covered >= to) return true;
  }
  return false;
}

export function toggleNoteInlineMark(
  text: string,
  marks: readonly NoteMark[],
  from: number,
  to: number,
  kind: "bold" | "italic",
): NoteMark[] {
  if (to <= from) return normalizeNoteMarks(text, marks);
  const other = marks.filter((mark) => mark.kind !== kind);
  const same = normalizeNoteMarks(text, marks).filter((mark) => mark.kind === kind);
  if (fullyCovered(same, from, to, kind)) {
    return normalizeNoteMarks(text, [
      ...other,
      ...same.flatMap((mark) => [
        { ...mark, kind, from: mark.from, to: Math.min(mark.to, from) } as NoteMark,
        { ...mark, kind, from: Math.max(mark.from, to), to: mark.to } as NoteMark,
      ]),
    ]);
  }
  const additions: NoteMark[] = [];
  let cursor = from;
  for (const mark of same) {
    if (mark.to <= cursor || mark.from >= to) continue;
    if (mark.from > cursor) additions.push({ kind, from: cursor, to: Math.min(mark.from, to) });
    cursor = Math.max(cursor, mark.to);
    if (cursor >= to) break;
  }
  if (cursor < to) additions.push({ kind, from: cursor, to });
  return normalizeNoteMarks(text, [...other, ...same, ...additions]);
}

export function toggleNoteHeading(
  text: string,
  marks: readonly NoteMark[],
  from: number,
  to: number,
  level: NoteHeadingLevel,
): NoteMark[] {
  const targets = lineRanges(text, from, to);
  if (!targets.length) return normalizeNoteMarks(text, marks);
  const targetStarts = new Set(targets.map((range) => range.from));
  const normalized = normalizeNoteMarks(text, marks);
  const headings = normalized.filter((mark) => mark.kind === "heading");
  const remove = targets.every((range) =>
    headings.some((mark) => mark.from === range.from && mark.level === level),
  );
  return normalizeNoteMarks(text, [
    ...normalized.filter((mark) => mark.kind !== "heading" || !targetStarts.has(mark.from)),
    ...(remove
      ? []
      : targets.map((range) => ({
          ...headings.find((mark) => mark.from === range.from),
          ...range,
          kind: "heading" as const,
          level,
        }))),
  ]);
}

export function mapNoteMarks(
  marks: readonly NoteMark[],
  changes: ChangeSet,
  nextText: string,
): NoteMark[] {
  return normalizeNoteMarks(
    nextText,
    marks.map((mark) => ({
      ...mark,
      from: changes.mapPos(mark.from, 1),
      to: changes.mapPos(mark.to, -1),
    })),
  );
}
