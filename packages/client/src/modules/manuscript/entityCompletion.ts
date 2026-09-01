import { normalizeEntityAliasV1 } from "../../shared";
import type { FigureNode } from "../story-world";

export type EntityCompletion = { entity: FigureNode; word: string; start: number; end: number };

const wordBefore = /[\p{L}\p{M}\p{N}'’-]+$/u;

/** Frozen cross-runtime identity fold shared with Python entity resolution. */
export function foldName(value: string): string {
  return normalizeEntityAliasV1(value);
}

/**
 * Search-only spelling fold for figure completion.
 *
 * Persisted aliases deliberately keep their frozen cross-runtime identity. Completion may be more
 * forgiving: diacritics are optional while typing and the common `ph`/`f` spelling pair is one
 * sound, not two mistakes (`Seraphine`, `Serafine`, `Séraphine`).
 */
export function foldCompletionName(value: string): string {
  return foldCompletionSpelling(value).replaceAll("ph", "f");
}

/**
 * Accent-insensitive spelling used alongside the phonetic completion fold.
 *
 * Keeping this representation matters for typos *inside* a digraph. `Serapgi`, for example, is
 * one substitution away from the still-being-typed prefix `Seraphi`. If both sides were reduced
 * to the `ph`/`f` form first, the mistyped `g` would break the digraph and make that same typo look
 * like three unrelated edits.
 */
function foldCompletionSpelling(value: string): string {
  return normalizeEntityAliasV1(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("de-DE");
}

function completionSpellings(value: string): readonly [string, string] {
  const spelling = foldCompletionSpelling(value);
  return [spelling, spelling.replaceAll("ph", "f")];
}

/**
 * One edit per five folded characters turns the writer's 80% similarity requirement into a
 * countable rule at every name length. The rule doubles as the length threshold: below five
 * characters the budget is zero and nothing is guessed at all. That matters, because at two or
 * three letters almost every name is one edit from almost every other beginning, and a wrong
 * suggestion accepted with a single Tab silently replaces a correctly typed word.
 */
function editBudget(length: number): number {
  return Math.floor(length / 5);
}

/**
 * Optimal string alignment (Levenshtein plus transposition, so `Taerk` sits one edit from
 * `Tarek`) between the typed word and *any prefix* of the name -- the name is still being typed,
 * so its tail must not count as errors.
 *
 * Only the diagonal band of width `budget` is filled; every cell outside it is worth at least
 * budget + 1 anyway, so the sentinel can never invent a cheap path. A row whose cheapest cell is
 * already over budget ends the comparison. Both together keep this at a handful of operations
 * per candidate instead of a full matrix, on every keystroke.
 */
export function nameDistance(typed: string, name: string, budget: number): number {
  const rows = typed.length,
    over = budget + 1;
  if (name.length + budget < rows) return over;
  const width = Math.min(name.length, rows + budget);
  let twoBack = new Int32Array(width + 1),
    back = new Int32Array(width + 1),
    row = new Int32Array(width + 1);
  for (let column = 0; column <= width; column++) back[column] = column;
  for (let line = 1; line <= rows; line++) {
    row.fill(over);
    row[0] = line;
    let cheapest = row[0];
    const first = Math.max(1, line - budget),
      last = Math.min(width, line + budget);
    for (let column = first; column <= last; column++) {
      const cost = typed[line - 1] === name[column - 1] ? 0 : 1;
      let value = Math.min(back[column] + 1, row[column - 1] + 1, back[column - 1] + cost);
      if (
        line > 1 &&
        column > 1 &&
        typed[line - 1] === name[column - 2] &&
        typed[line - 2] === name[column - 1]
      )
        value = Math.min(value, twoBack[column - 2] + 1);
      row[column] = value;
      if (value < cheapest) cheapest = value;
    }
    if (cheapest > budget) return over;
    [twoBack, back, row] = [back, row, twoBack];
  }
  let best = over;
  for (let column = Math.max(0, rows - budget); column <= width; column++)
    best = Math.min(best, back[column]);
  return best;
}

/**
 * The three tiers of a name suggestion.
 *
 * 1. A literal prefix -- unchanged from before, and it always wins. A fuzzy candidate never gets
 *    to make a deterministic match ambiguous.
 * 2. An unambiguous accent or `ph`/`f` prefix variant. Multiple folded prefixes mean silence.
 * 3. Only when neither prefix tier answers: the closest name within the edit budget. Here
 *    a tie means silence. Two names equally close are two guesses, and no suggestion is cheaper
 *    than the wrong one, which Tab would accept over a correctly typed word.
 *
 * `vocabulary` is the manuscript's own terms. A word the manuscript already knows is a word the
 * writer meant to write, so it is never corrected into a name.
 */
export function entityCompletion(
  value: string,
  caret: number,
  entities: FigureNode[],
  vocabulary: string[] = [],
): EntityCompletion | null {
  const prefix = value.slice(0, caret).match(wordBefore)?.[0] || "";
  if (prefix.length < 2) return null;
  const grouped = new Map<string, FigureNode[]>();
  for (const entity of entities) {
    const key = entity.name.toLocaleLowerCase("de-DE");
    grouped.set(key, [...(grouped.get(key) || []), entity]);
  }
  // Two figures of the same name are never worth guessing between -- the existing uniqueness guard.
  const named = [...grouped.entries()]
    .filter(([, nodes]) => nodes.length === 1)
    .sort(([a], [b]) => a.localeCompare(b, "de-DE"));
  const lower = prefix.toLocaleLowerCase("de-DE");
  const literalPrefix = named.find(
    ([name]) => name.length > lower.length && name.startsWith(lower),
  );
  const typed = foldCompletionName(prefix);
  const knownVocabularyWord = vocabulary.some((word) => foldCompletionName(word) === typed);
  const spellingPrefixes =
    literalPrefix || knownVocabularyWord ? [] : foldedPrefixes(typed, lower, named);
  let entity: FigureNode | null;
  if (literalPrefix) entity = literalPrefix[1][0];
  else if (knownVocabularyWord || spellingPrefixes.length > 1) entity = null;
  else entity = spellingPrefixes[0] || closestName(prefix, lower, named, vocabulary);
  return entity ? { entity, word: entity.name, start: caret - prefix.length, end: caret } : null;
}

/**
 * Collects accent and `ph`/`f` prefix variants. They work from two folded characters on and
 * outrank fuzzy edits, but the caller refuses to choose when this returns more than one figure.
 */
function foldedPrefixes(
  typed: string,
  lower: string,
  named: [string, FigureNode[]][],
): FigureNode[] {
  if (typed.length < 2) return [];
  return named.flatMap(([name, nodes]) => {
    if (name === lower || !foldCompletionName(name).startsWith(typed)) return [];
    return nodes[0];
  });
}

function closestName(
  prefix: string,
  lower: string,
  named: [string, FigureNode[]][],
  vocabulary: string[],
): FigureNode | null {
  const typedSpellings = completionSpellings(prefix);
  const typed = typedSpellings[1];
  if (!typed) return null;
  // The 80% threshold belongs to what the writer actually entered. A valid `ph` pair may collapse
  // for phonetic comparison, but must not make the input look shorter and therefore stricter.
  const budget = editBudget(typedSpellings[0].length);
  if (!budget) return null;
  if (vocabulary.some((word) => foldCompletionName(word) === typed)) return null;
  let best: FigureNode | null = null,
    closest = budget + 1,
    ambiguous = false;
  for (const [name, nodes] of named) {
    // Already written, only differently cased -- there is nothing to complete.
    if (name === lower) continue;
    const nameSpellings = completionSpellings(name);
    // Compare like with like: ordinary spelling preserves a broken `ph` digraph, while the
    // phonetic spelling deliberately equates a correctly typed `ph` with `f`.
    const distance = Math.min(
      nameDistance(typedSpellings[0], nameSpellings[0], budget),
      nameDistance(typedSpellings[1], nameSpellings[1], budget),
    );
    if (distance > budget) continue;
    if (distance < closest) {
      best = nodes[0];
      closest = distance;
      ambiguous = false;
    } else if (distance === closest) ambiguous = true;
  }
  return ambiguous ? null : best;
}
