import { describe, expect, it } from 'vitest';
import type { FigureEdge, FigureNode, TimelineMoment } from '../../types';
import { alignNodesToGrid, connectionKind, figureIsDeceased, patchRelationship, relationshipHandles, relationshipKey, relationshipLabelEditor, resolveRelationship, resolveRelationshipOverview, semanticZoomTier } from './FigureWorkspace';

const timeline: TimelineMoment[] = [
  { id: 'before', title: 'Vorher' },
  { id: 'betrayal', title: 'Verrat', date: '1420-03-12' },
  { id: 'after', title: 'Danach' },
];

describe('relationship timeline', () => {
  it('reduces detail in stable semantic zoom stages', () => {
    expect(semanticZoomTier(1)).toBe('detail');
    expect(semanticZoomTier(0.5)).toBe('compact');
    expect(semanticZoomTier(0.2)).toBe('overview');
  });
  it('aligns all elements to the coarse grid without changing their content', () => {
    const nodes: FigureNode[] = [{ id: 'n1', x: 73, y: -70, name: 'A' }, { id: 'n2', x: 121, y: 167, name: 'B' }];
    expect(alignNodesToGrid(nodes)).toEqual([{ id: 'n1', x: 96, y: -48, name: 'A' }, { id: 'n2', x: 144, y: 144, name: 'B' }]);
    expect(nodes[0]).toMatchObject({ x: 73, y: -70 });
  });
  it('distinguishes directed and centered undirected connectors', () => {
    expect(connectionKind('out', 'in')).toBe('directed');
    expect(connectionKind('neutral-top', 'neutral-bottom')).toBe('undirected');
    expect(connectionKind('out', 'neutral-top')).toBeNull();
    expect(relationshipKey('a', 'b', true)).not.toBe(relationshipKey('b', 'a', true));
    expect(relationshipKey('a', 'b', false)).toBe(relationshipKey('b', 'a', false));
  });
  it('adapts undirected handles to the shortest, outward-facing route', () => {
    const nodes: FigureNode[] = [
      { id: 'top-left', x: 0, y: 0, name: 'A' },
      { id: 'top-right', x: 300, y: 10, name: 'B' },
      { id: 'bottom', x: 150, y: 300, name: 'C' },
    ];
    expect(relationshipHandles({ id: 'e1', from: 'top-left', to: 'bottom', label: '' }, nodes)).toEqual({ from: 'neutral-bottom', to: 'neutral-top' });
    expect(relationshipHandles({ id: 'e2', from: 'top-left', to: 'top-right', label: '', fromHandle: 'neutral-bottom', toHandle: 'neutral-bottom' }, nodes)).toEqual({ from: 'neutral-top', to: 'neutral-top' });
  });
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

  it('inherits the previous label when the current timeline text is deleted', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Freunde', versions: [
      { momentId: 'betrayal', label: 'Feinde', active: true },
      { momentId: 'after', label: 'Versöhnt', active: true },
    ] };
    const changed = patchRelationship(edge, timeline, 'after', { label: '' });
    expect(changed.versions?.find(version => version.momentId === 'after')).not.toHaveProperty('label');
    expect(resolveRelationship(changed, timeline, 'after').label).toBe('Feinde');
    expect(relationshipLabelEditor(changed, timeline, 'after')).toEqual({ value: '', inherited: 'Feinde' });
    expect(resolveRelationship(changed, timeline, 'betrayal').label).toBe('Feinde');
  });

  it('reverses a directed relationship only from the selected moment onward', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Folgt', gerichtet: true };
    const changed = patchRelationship(edge, timeline, 'betrayal', { from: 'b', to: 'a' });
    expect(changed).toMatchObject({ from: 'a', to: 'b' });
    expect(resolveRelationship(changed, timeline, 'before')).toMatchObject({ from: 'a', to: 'b' });
    expect(resolveRelationship(changed, timeline, 'betrayal')).toMatchObject({ from: 'b', to: 'a' });
    expect(resolveRelationship(changed, timeline, 'after')).toMatchObject({ from: 'b', to: 'a' });
    expect(changed.versions).toHaveLength(1);
  });

  it('preserves a reversed direction through later partial versions', () => {
    const edge: FigureEdge = { id: 'e1', from: 'a', to: 'b', label: 'Folgt', gerichtet: true, versions: [
      { momentId: 'betrayal', from: 'b', to: 'a', label: 'Jagt', active: true },
      { momentId: 'after', label: 'Meidet', active: true },
    ] };
    expect(resolveRelationship(edge, timeline, 'after')).toMatchObject({ from: 'b', to: 'a', label: 'Meidet' });
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
