import type { FigureNode } from "../../types";

export type EntityCompletion = { entity: FigureNode; word: string; start: number; end: number };

const wordBefore = /[\p{L}\p{N}'’-]+$/u;

/**
 * Names are compared, not prose: `Müller` and `Muller`, `Straße` and `Strasse` are the same
 * name spelled with the keys the writer had at hand. Lowercasing is de-DE like everywhere else,
 * ß becomes ss, and the umlaut dots are dropped by decomposing and removing the combining marks
 * -- so `Mueller` stays one insertion away from `Müller` instead of two substitutions.
 */
export function foldName(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

/**
 * One edit per five typed characters -- the writer's "roughly 80% confidence" turned into a
 * countable rule -- and never more than two, because past that a word is not mistyped, it is a
 * different word. The rule doubles as the length threshold: below five characters the budget is
 * zero and nothing is guessed at all. That matters, because at two or three letters almost every
 * name is one edit from almost every other beginning, and a wrong suggestion accepted with a
 * single Tab silently replaces a correctly typed word.
 */
function editBudget(length: number): number {
  return Math.min(2, Math.floor(length / 5));
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
 * The two tiers of a name suggestion.
 *
 * 1. A literal prefix -- unchanged from before, and it always wins. A fuzzy candidate never gets
 *    to make a deterministic match ambiguous.
 * 2. Only when nothing starts with what was typed: the closest name within the edit budget. Here
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
  const exact = named.find(([name]) => name.length > lower.length && name.startsWith(lower));
  const entity = exact ? exact[1][0] : closestName(prefix, lower, named, vocabulary);
  return entity ? { entity, word: entity.name, start: caret - prefix.length, end: caret } : null;
}

function closestName(
  prefix: string,
  lower: string,
  named: [string, FigureNode[]][],
  vocabulary: string[],
): FigureNode | null {
  const budget = editBudget(prefix.length);
  if (!budget) return null;
  const typed = foldName(prefix);
  if (!typed) return null;
  if (vocabulary.some((word) => foldName(word) === typed)) return null;
  let best: FigureNode | null = null,
    closest = budget + 1,
    ambiguous = false;
  for (const [name, nodes] of named) {
    // Already written, only differently cased -- there is nothing to complete.
    if (name === lower) continue;
    const folded = foldName(name);
    // The first letter is the one the writer is sure of; an edit there is a different word, not a
    // typo. It also rejects nearly every candidate before any matrix is touched.
    if (folded[0] !== typed[0]) continue;
    const distance = nameDistance(typed, folded, budget);
    if (distance > budget) continue;
    if (distance < closest) {
      best = nodes[0];
      closest = distance;
      ambiguous = false;
    } else if (distance === closest) ambiguous = true;
  }
  return ambiguous ? null : best;
}
