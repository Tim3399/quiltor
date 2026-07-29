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
});
