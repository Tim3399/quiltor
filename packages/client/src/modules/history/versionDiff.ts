export type VersionDiffKind = "unchanged" | "added" | "removed";

export interface VersionDiffSegment {
  kind: VersionDiffKind;
  text: string;
}

// Keep words, punctuation and whitespace as independent tokens. That lets the rendered diff
// preserve the author's exact line breaks while still highlighting a changed word instead of a
// whole paragraph.
const TOKEN_PATTERN = /\s+|[\p{L}\p{N}\p{M}_]+|[^\s\p{L}\p{N}\p{M}_]+/gu;
const MAX_EXACT_DIFF_CELLS = 250_000;

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

function exactDiff(previous: string[], selected: string[]): VersionDiffSegment[] {
  const lengths = Array.from(
    { length: previous.length + 1 },
    () => new Uint32Array(selected.length + 1),
  );

  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex--) {
    for (let selectedIndex = selected.length - 1; selectedIndex >= 0; selectedIndex--) {
      lengths[previousIndex][selectedIndex] =
        previous[previousIndex] === selected[selectedIndex]
          ? lengths[previousIndex + 1][selectedIndex + 1] + 1
          : Math.max(
              lengths[previousIndex + 1][selectedIndex],
              lengths[previousIndex][selectedIndex + 1],
            );
    }
  }

  const segments: VersionDiffSegment[] = [];
  let previousIndex = 0;
  let selectedIndex = 0;
  while (previousIndex < previous.length && selectedIndex < selected.length) {
    if (previous[previousIndex] === selected[selectedIndex]) {
      append(segments, "unchanged", previous[previousIndex]);
      previousIndex++;
      selectedIndex++;
    } else if (
      lengths[previousIndex + 1][selectedIndex] >= lengths[previousIndex][selectedIndex + 1]
    ) {
      append(segments, "removed", previous[previousIndex]);
      previousIndex++;
    } else {
      append(segments, "added", selected[selectedIndex]);
      selectedIndex++;
    }
  }
  append(segments, "removed", previous.slice(previousIndex).join(""));
  append(segments, "added", selected.slice(selectedIndex).join(""));
  return segments;
}

/**
 * Produces an inline, word-oriented comparison from one saved chapter version to its direct
 * predecessor. Common prefix and suffix tokens are removed before the exact comparison, so a
 * small edit in a long chapter stays cheap. A complete, very large rewrite deliberately falls
 * back to one removed and one added block instead of blocking the editor with a quadratic diff.
 */
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
  } else if (previousMiddle.length * selectedMiddle.length <= MAX_EXACT_DIFF_CELLS) {
    for (const segment of exactDiff(previousMiddle, selectedMiddle)) {
      append(segments, segment.kind, segment.text);
    }
  } else {
    append(segments, "removed", previousMiddle.join(""));
    append(segments, "added", selectedMiddle.join(""));
  }

  append(segments, "unchanged", previous.slice(previous.length - suffixLength).join(""));
  return segments;
}
