import { describe, expect, it } from 'vitest';
import { applyAssistantProposals } from './proposals';

describe('assistant proposals', () => {
  it('creates linked elements, a moment and a temporal relationship without touching manuscript data', () => {
    const result = applyAssistantProposals({ nodes: [], edges: [] }, [
      { kind: 'create_element', tempId: 'new:a', element: { name: 'Ada', type: 'person' } },
      { kind: 'create_element', tempId: 'new:b', element: { name: 'Bela', type: 'person' } },
      { kind: 'create_timeline_moment', tempId: 'new:m', moment: { title: 'Begegnung' } },
      { kind: 'create_relationship', relationship: { from: 'new:a', to: 'new:b', label: 'Misstrauen', directed: false } },
      { kind: 'mark_deceased', elementId: 'new:b', momentId: 'new:m' },
    ]);
    expect(result.nodes.map(node => node.name)).toEqual(['Ada', 'Bela']);
    expect(result.edges[0]).toMatchObject({ label: 'Misstrauen', gerichtet: false });
    expect(result.nodes[1].diedMomentId).toBe(result.timeline?.[0].id);
  });

  it('arranges connected thematic groups without losing elements or relationships', () => {
    const state = { nodes: [
      { id: 'a', x: 700, y: 500, type: 'person' as const, name: 'Ada' },
      { id: 'b', x: 720, y: 520, type: 'person' as const, name: 'Bela' },
      { id: 'c', x: 740, y: 540, type: 'ort' as const, name: 'Cella' },
    ], edges: [{ id: 'e', from: 'a', to: 'b', label: 'Verbündet' }] };
    const result = applyAssistantProposals(state, [{ kind: 'arrange_elements', strategy: 'thematic' }]);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toEqual(state.edges);
    expect(new Set(result.nodes.map(node => `${node.x}:${node.y}`)).size).toBe(3);
  });
});
