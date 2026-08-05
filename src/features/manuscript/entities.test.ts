import { describe, expect, it } from 'vitest';
import { detectEntities } from './entities';
import type { FigureNode } from '../../types';

const nodes = [
  { id: 'mara', name: 'Mara Venn', type: 'person' },
  { id: 'tarek', name: 'Tarek Venn', type: 'person' },
  { id: 'seal', name: 'Staatssiegel', type: 'konzept' },
] as FigureNode[];

describe('detectEntities', () => {
  it('finds whole-word mentions and maps them to their node', () => {
    const text = 'Mara Venn und Tarek Venn suchen das Staatssiegel.';
    const spans = detectEntities(text, nodes);
    expect(spans.map(s => [text.slice(s.start, s.end), s.id])).toEqual([
      ['Mara Venn', 'mara'],
      ['Tarek Venn', 'tarek'],
      ['Staatssiegel', 'seal'],
    ]);
  });

  it('does not match inside a longer word', () => {
    expect(detectEntities('Maravenn steht hier.', nodes)).toHaveLength(0);
  });

  it('prefers the longer name and never overlaps', () => {
    // "Venn" alone would collide with "Mara Venn"; the longer name wins, one span only.
    const withShort = [...nodes, { id: 'venn', name: 'Venn', type: 'person' } as FigureNode];
    const spans = detectEntities('Mara Venn geht.', withShort);
    expect(spans).toHaveLength(1);
    expect(spans[0].id).toBe('mara');
  });
});
