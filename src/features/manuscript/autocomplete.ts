import type { FigureState, Manuscript } from '../../types';

export type WordCompletion = { word: string; start: number; end: number };

export function writingVocabulary(manuscript: Manuscript, _figures: FigureState): string[] {
  const terms = [
    ...(manuscript.words || []).flatMap(item => (typeof item === 'string' ? item : item.w).split(/[^\p{L}\p{N}'’-]+/u)),
  ].map(term => term.trim()).filter(term => term.length >= 2);
  return [...new Map(terms.map(term => [term.toLocaleLowerCase('de-DE'), term])).values()]
    .sort((a, b) => a.localeCompare(b, 'de-DE'));
}

export function completeOneWord(value: string, caret: number, vocabulary: string[]): WordCompletion | null {
  const before = value.slice(0, caret), match = before.match(/[\p{L}\p{N}'’-]+$/u);
  if (!match || match[0].length < 2) return null;
  const prefix = match[0], folded = prefix.toLocaleLowerCase('de-DE');
  const candidates = vocabulary.filter(word => word.length > prefix.length && word.toLocaleLowerCase('de-DE').startsWith(folded));
  if (!candidates.length) return null;
  const word = candidates[0];
  return { word, start: caret - prefix.length, end: caret };
}
