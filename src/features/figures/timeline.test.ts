import { describe, expect, it } from 'vitest';
import type { FigureEdge, FigureNode, TimelineMoment } from '../../types';
import { figureIsDeceased, patchRelationship, resolveRelationship, resolveRelationshipOverview } from './FigureWorkspace';

const timeline: TimelineMoment[] = [
  { id: 'before', title: 'Vorher' },
  { id: 'betrayal', title: 'Verrat', date: '1420-03-12' },
  { id: 'after', title: 'Danach' },
];

describe('relationship timeline', () => {
  it('uses the latest relationship version at a selected moment', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Freunde', versions: [
      { momentId: 'betrayal', label: 'Feinde', active: true },
      { momentId: 'after', label: 'Versöhnt', active: true },
    ] };
    expect(resolveRelationship(edge, timeline, 'before').label).toBe('Freunde');
    expect(resolveRelationship(edge, timeline, 'betrayal').label).toBe('Feinde');
    expect(resolveRelationship(edge, timeline, 'after').label).toBe('Versöhnt');
  });

  it('creates a version instead of overwriting the earlier relationship', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Freunde' };
    const changed = patchRelationship(edge, timeline, 'betrayal', { label: 'Feinde' });
    expect(changed.label).toBe('Freunde');
    expect(resolveRelationship(changed, timeline, 'betrayal').label).toBe('Feinde');
  });

  it('shows every relationship and its label changes in the complete overview', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Freunde', active: false, versions: [
      { momentId: 'betrayal', label: 'Feinde', active: true },
      { momentId: 'after', label: 'Versöhnt', active: true },
    ] };
    const overview = resolveRelationshipOverview(edge, timeline);
    expect(overview.active).toBe(true);
    expect(overview.label).toBe('Freunde → Feinde → Versöhnt');
  });

  it('marks a figure deceased from its death moment onward', () => {
    const figure: FigureNode = { id: 'n1', x: 0, y: 0, name: 'A', diedMomentId: 'betrayal' };
    expect(figureIsDeceased(figure, timeline, 'before')).toBe(false);
    expect(figureIsDeceased(figure, timeline, 'betrayal')).toBe(true);
    expect(figureIsDeceased(figure, timeline, 'after')).toBe(true);
  });
});
