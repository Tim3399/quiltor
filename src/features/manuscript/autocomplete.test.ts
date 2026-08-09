import { describe, expect, it } from 'vitest';
import { completeOneWord, writingVocabulary } from './autocomplete';

describe('deterministic writing autocomplete', () => {
  it('uses only helper vocabulary and returns one complete word', () => {
    const vocabulary = writingVocabulary({ chapters: [], words: ['Frostkloster'] }, { nodes: [{ id: 'm', x: 0, y: 0, type: 'person', name: 'Mara Venn' }], edges: [] });
    expect(completeOneWord('Sie betritt das Frostk', 22, vocabulary)?.word).toBe('Frostkloster');
    expect(completeOneWord('Ma', 2, vocabulary)).toBeNull();
  });

  it('does not suggest prose or already completed words', () => {
    expect(completeOneWord('Mara', 4, ['Mara'])).toBeNull();
    expect(completeOneWord('M', 1, ['Mara'])).toBeNull();
    expect(completeOneWord('Unbekannt', 9, ['Mara'])).toBeNull();
  });
});
