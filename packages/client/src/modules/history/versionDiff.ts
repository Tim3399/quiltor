import { normalizeMarks, type TextMark, type TextMarkKind } from "../manuscript";

export type VersionDiffKind = "unchanged" | "added" | "removed";

export interface VersionDiffSegment {
  kind: VersionDiffKind;
  text: string;
}

export type VersionTextChange =
  | { kind: "added"; from: number; to: number; text: string }
  | { kind: "removed"; at: number; text: string };

export interface VersionEqualSpan {
  previousFrom: number;
  previousTo: number;
  selectedFrom: number;
  selectedTo: number;
}

export interface VersionFormattingChange {
  kind: "format-added" | "format-removed";
  markKind: TextMarkKind;
  from: number;
  to: number;
}

export interface VersionDiffProjection {
  changes: VersionTextChange[];
  equalSpans: VersionEqualSpan[];
  formattingChanges: VersionFormattingChange[];
}

// Keep words, punctuation and whitespace independent. Exact token text is retained, including
// line endings and Unicode combining marks, while changes normally stop at word boundaries.
const TOKEN_PATTERN =
  /\r\n|[\n\r\u2028\u2029]|[^\S\r\n\u2028\u2029]+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]/gu;
const MAX_MYERS_FRONTIER_STEPS = 250_000;
const MYERS_SNAKE_WORK_FACTOR = 16;
const ANCHOR_WIDTH = 8;
const MARK_KINDS: TextMarkKind[] = ["bold", "italic"];

function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

function append(segments: VersionDiffSegment[], kind: VersionDiffKind, text: string): void {
  if (!text) return;
  const last = segments.at(-1);
  if (last?.kind === kind) {
    last.text += text;
    return;
  }
  segments.push({ kind, text });
}

/**
 * Myers' shortest-edit-path algorithm. Its frontier stays tiny for sparse edits regardless of
 * how far apart they are. The fixed frontier budget bounds broad rewrites; callers then render
 * that unresolved region as one removal and one addition.
 */
function boundedDiff(previous: string[], selected: string[]): VersionDiffSegment[] | undefined {
  const trace: Array<Map<number, number>> = [];
  let frontier = new Map<number, number>([[1, 0]]);
  let remainingFrontierSteps = MAX_MYERS_FRONTIER_STEPS;
  // Successful diagonal scans are linear in input size for the sparse case. Keep their budget
  // separate so a very long equal passage does not consume the fixed edit-frontier allowance.
  let remainingSnakeSteps = (previous.length + selected.length) * MYERS_SNAKE_WORK_FACTOR;
  const maximumDistance = previous.length + selected.length;

  for (let distance = 0; distance <= maximumDistance; distance++) {
    const next = new Map<number, number>();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (--remainingFrontierSteps < 0) return undefined;
      const down = frontier.get(diagonal + 1) ?? -1;
      const right = frontier.get(diagonal - 1) ?? -1;
      let previousIndex =
        diagonal === -distance || (diagonal !== distance && right < down) ? down : right + 1;
      let selectedIndex = previousIndex - diagonal;
      while (
        previousIndex < previous.length &&
        selectedIndex < selected.length &&
        previous[previousIndex] === selected[selectedIndex]
      ) {
        if (--remainingSnakeSteps < 0) return undefined;
        previousIndex++;
        selectedIndex++;
      }
      next.set(diagonal, previousIndex);
      if (previousIndex >= previous.length && selectedIndex >= selected.length) {
        trace.push(next);
        return backtrack(previous, selected, trace);
      }
    }
    trace.push(next);
    frontier = next;
  }
  return undefined;
}

type Anchor = { previous: number; selected: number };

function windowKey(tokens: string[], start: number): string {
  let key = "";
  for (let index = start; index < start + ANCHOR_WIDTH; index++) {
    key += `${tokens[index].length}:${tokens[index]}`;
  }
  return key;
}

function uniqueWindows(tokens: string[]): Map<string, number> {
  const windows = new Map<string, number>();
  for (let index = 0; index <= tokens.length - ANCHOR_WIDTH; index++) {
    const key = windowKey(tokens, index);
    windows.set(key, windows.has(key) ? -1 : index);
  }
  return windows;
}

/** Longest increasing subsequence by selected position, preserving source order as well. */
function orderedAnchors(previous: string[], selected: string[]): Anchor[] {
  if (previous.length < ANCHOR_WIDTH || selected.length < ANCHOR_WIDTH) return [];
  const previousWindows = uniqueWindows(previous);
  const selectedWindows = uniqueWindows(selected);
  const candidates: Anchor[] = [];
  for (const [key, previousIndex] of previousWindows) {
    const selectedIndex = selectedWindows.get(key);
    if (previousIndex >= 0 && selectedIndex !== undefined && selectedIndex >= 0) {
      candidates.push({ previous: previousIndex, selected: selectedIndex });
    }
  }
  candidates.sort((a, b) => a.previous - b.previous || a.selected - b.selected);
  if (!candidates.length) return [];

  const tails: number[] = [];
  const parents = new Int32Array(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]].selected < candidates[index].selected) low = middle + 1;
      else high = middle;
    }
    if (low > 0) parents[index] = tails[low - 1];
    tails[low] = index;
  }

  const increasing: Anchor[] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = parents[index]) {
    increasing.push(candidates[index]);
  }
  increasing.reverse();

  const nonOverlapping: Anchor[] = [];
  for (const anchor of increasing) {
    const last = nonOverlapping.at(-1);
    if (
      !last ||
      (anchor.previous >= last.previous + ANCHOR_WIDTH &&
        anchor.selected >= last.selected + ANCHOR_WIDTH)
    ) {
      nonOverlapping.push(anchor);
    }
  }
  return nonOverlapping;
}

/**
 * Keep unique, ordered windows from a too-expensive rewrite. Unresolved gaps remain bounded
 * removal/addition blocks, while a large stable passage between rewritten regions stays visible.
 */
function anchoredFallback(previous: string[], selected: string[]): VersionDiffSegment[] {
  const anchors = orderedAnchors(previous, selected);
  if (!anchors.length) {
    return [
      { kind: "removed", text: previous.join("") },
      { kind: "added", text: selected.join("") },
    ];
  }

  const segments: VersionDiffSegment[] = [];
  let previousIndex = 0;
  let selectedIndex = 0;
  for (const anchor of anchors) {
    append(segments, "removed", previous.slice(previousIndex, anchor.previous).join(""));
    append(segments, "added", selected.slice(selectedIndex, anchor.selected).join(""));
    append(
      segments,
      "unchanged",
      previous.slice(anchor.previous, anchor.previous + ANCHOR_WIDTH).join(""),
    );
    previousIndex = anchor.previous + ANCHOR_WIDTH;
    selectedIndex = anchor.selected + ANCHOR_WIDTH;
  }
  append(segments, "removed", previous.slice(previousIndex).join(""));
  append(segments, "added", selected.slice(selectedIndex).join(""));
  return segments;
}

function backtrack(
  previous: string[],
  selected: string[],
  trace: Array<Map<number, number>>,
): VersionDiffSegment[] {
  const reversed: VersionDiffSegment[] = [];
  let previousIndex = previous.length;
  let selectedIndex = selected.length;

  for (let distance = trace.length - 1; distance > 0; distance--) {
    const frontier = trace[distance - 1];
    const diagonal = previousIndex - selectedIndex;
    const down = frontier.get(diagonal + 1) ?? -1;
    const right = frontier.get(diagonal - 1) ?? -1;
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && right < down)
        ? diagonal + 1
        : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (previousIndex > previousX && selectedIndex > previousY) {
      reversed.push({ kind: "unchanged", text: previous[--previousIndex] });
      selectedIndex--;
    }
    if (previousIndex === previousX) {
      reversed.push({ kind: "added", text: selected[--selectedIndex] });
    } else {
      reversed.push({ kind: "removed", text: previous[--previousIndex] });
    }
  }

  while (previousIndex > 0 && selectedIndex > 0) {
    reversed.push({ kind: "unchanged", text: previous[--previousIndex] });
    selectedIndex--;
  }

  const segments: VersionDiffSegment[] = [];
  for (let index = reversed.length - 1; index >= 0; index--) {
    append(segments, reversed[index].kind, reversed[index].text);
  }
  return segments;
}

/** Produces an exact, word-oriented inline comparison of two chapter versions. */
export function diffVersionText(previousText: string, selectedText: string): VersionDiffSegment[] {
  if (previousText === selectedText) {
    return selectedText ? [{ kind: "unchanged", text: selectedText }] : [];
  }

  const previous = tokenize(previousText);
  const selected = tokenize(selectedText);
  let prefixLength = 0;
  while (
    prefixLength < previous.length &&
    prefixLength < selected.length &&
    previous[prefixLength] === selected[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < previous.length - prefixLength &&
    suffixLength < selected.length - prefixLength &&
    previous[previous.length - 1 - suffixLength] === selected[selected.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const previousMiddle = previous.slice(prefixLength, previous.length - suffixLength);
  const selectedMiddle = selected.slice(prefixLength, selected.length - suffixLength);
  const segments: VersionDiffSegment[] = [];
  append(segments, "unchanged", previous.slice(0, prefixLength).join(""));

  if (previousMiddle.length === 0) {
    append(segments, "added", selectedMiddle.join(""));
  } else if (selectedMiddle.length === 0) {
    append(segments, "removed", previousMiddle.join(""));
  } else {
    const middle = boundedDiff(previousMiddle, selectedMiddle);
    if (middle) {
      for (const segment of middle) append(segments, segment.kind, segment.text);
    } else {
      for (const segment of anchoredFallback(previousMiddle, selectedMiddle)) {
        append(segments, segment.kind, segment.text);
      }
    }
  }

  append(segments, "unchanged", previous.slice(previous.length - suffixLength).join(""));
  return segments;
}

function markChangesForSpan(
  span: VersionEqualSpan,
  previousMarks: Record<TextMarkKind, TextMark[]>,
  selectedMarks: Record<TextMarkKind, TextMark[]>,
): VersionFormattingChange[] {
  const changes: VersionFormattingChange[] = [];
  for (const markKind of MARK_KINDS) {
    const oldRanges: Array<{ from: number; to: number }> = [];
    const oldMarks = previousMarks[markKind];
    let oldMarkIndex = firstRangeEndingAfter(oldMarks, span.previousFrom);
    while (oldMarkIndex < oldMarks.length && oldMarks[oldMarkIndex].from < span.previousTo) {
      const mark = oldMarks[oldMarkIndex++];
      oldRanges.push({
        from: span.selectedFrom + Math.max(mark.from, span.previousFrom) - span.previousFrom,
        to: span.selectedFrom + Math.min(mark.to, span.previousTo) - span.previousFrom,
      });
    }
    const newRanges: Array<{ from: number; to: number }> = [];
    const newMarks = selectedMarks[markKind];
    let newMarkIndex = firstRangeEndingAfter(newMarks, span.selectedFrom);
    while (newMarkIndex < newMarks.length && newMarks[newMarkIndex].from < span.selectedTo) {
      const mark = newMarks[newMarkIndex++];
      newRanges.push({
        from: Math.max(mark.from, span.selectedFrom),
        to: Math.min(mark.to, span.selectedTo),
      });
    }
    const boundaries = new Set<number>([span.selectedFrom, span.selectedTo]);
    for (const range of [...oldRanges, ...newRanges]) {
      boundaries.add(range.from);
      boundaries.add(range.to);
    }
    const cuts = [...boundaries].sort((a, b) => a - b);
    let oldRangeIndex = 0;
    let newRangeIndex = 0;
    for (let index = 0; index < cuts.length - 1; index++) {
      const from = cuts[index];
      const to = cuts[index + 1];
      while (oldRangeIndex < oldRanges.length && oldRanges[oldRangeIndex].to <= from)
        oldRangeIndex++;
      while (newRangeIndex < newRanges.length && newRanges[newRangeIndex].to <= from)
        newRangeIndex++;
      const oldRange = oldRanges[oldRangeIndex];
      const newRange = newRanges[newRangeIndex];
      const wasMarked = oldRange !== undefined && oldRange.from <= from && oldRange.to >= to;
      const isMarked = newRange !== undefined && newRange.from <= from && newRange.to >= to;
      if (wasMarked === isMarked) continue;
      const kind = isMarked ? "format-added" : "format-removed";
      const last = changes.at(-1);
      if (last?.kind === kind && last.markKind === markKind && last.to === from) last.to = to;
      else changes.push({ kind, markKind, from, to });
    }
  }
  return changes;
}

function firstRangeEndingAfter(marks: TextMark[], position: number): number {
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (marks[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function marksByKind(marks: TextMark[]): Record<TextMarkKind, TextMark[]> {
  return {
    bold: marks.filter((mark) => mark.kind === "bold"),
    italic: marks.filter((mark) => mark.kind === "italic"),
  };
}

export function diffVersion(
  previousText: string,
  selectedText: string,
  previousMarks: TextMark[] = [],
  selectedMarks: TextMark[] = [],
): VersionDiffProjection {
  const changes: VersionTextChange[] = [];
  const equalSpans: VersionEqualSpan[] = [];
  let previousOffset = 0;
  let selectedOffset = 0;

  for (const segment of diffVersionText(previousText, selectedText)) {
    if (segment.kind === "unchanged") {
      equalSpans.push({
        previousFrom: previousOffset,
        previousTo: previousOffset + segment.text.length,
        selectedFrom: selectedOffset,
        selectedTo: selectedOffset + segment.text.length,
      });
      previousOffset += segment.text.length;
      selectedOffset += segment.text.length;
    } else if (segment.kind === "removed") {
      changes.push({ kind: "removed", at: selectedOffset, text: segment.text });
      previousOffset += segment.text.length;
    } else {
      changes.push({
        kind: "added",
        from: selectedOffset,
        to: selectedOffset + segment.text.length,
        text: segment.text,
      });
      selectedOffset += segment.text.length;
    }
  }

  const normalizedPreviousMarks = marksByKind(normalizeMarks(previousMarks, previousText.length));
  const normalizedSelectedMarks = marksByKind(normalizeMarks(selectedMarks, selectedText.length));
  const formattingChanges = equalSpans
    .flatMap((span) => markChangesForSpan(span, normalizedPreviousMarks, normalizedSelectedMarks))
    .sort(
      (a, b) =>
        a.from - b.from ||
        a.to - b.to ||
        a.markKind.localeCompare(b.markKind) ||
        a.kind.localeCompare(b.kind),
    );

  return { changes, equalSpans, formattingChanges };
}
