import { describe, expect, it } from 'vitest';
import { applyAssistantProposals } from './proposals';
import { de } from '../../language/de';
import type { MessageKey } from '../../language';

const t = (key: MessageKey) => de[key];

describe('assistant proposals', () => {
  it('creates linked elements, a moment and a temporal relationship without touching manuscript data', () => {
    const result = applyAssistantProposals({ nodes: [], edges: [] }, [
      { kind: 'create_element', tempId: 'new:a', element: { name: 'Ada', type: 'person' } },
      { kind: 'create_element', tempId: 'new:b', element: { name: 'Bela', type: 'person' } },
      { kind: 'create_timeline_moment', tempId: 'new:m', moment: { title: 'Begegnung' } },
      { kind: 'create_relationship', relationship: { from: 'new:a', to: 'new:b', label: 'Misstrauen', directed: false } },
      { kind: 'mark_deceased', elementId: 'new:b', momentId: 'new:m' },
    ], t);
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
    const result = applyAssistantProposals(state, [{ kind: 'arrange_elements', strategy: 'thematic' }], t);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toEqual(state.edges);
    expect(new Set(result.nodes.map(node => `${node.x}:${node.y}`)).size).toBe(3);
  });

  it('replaces presence only at the proposed base or timeline state', () => {
    const state = {
      nodes: [{ id: 'mara', x: 0, y: 0, name: 'Mara', type: 'person' as const }, { id: 'hafen', x: 0, y: 0, name: 'Hafen', type: 'ort' as const }, { id: 'archiv', x: 0, y: 0, name: 'Archiv', type: 'ort' as const }],
      edges: [], timeline: [{ id: 'trial', title: 'Prozess' }],
      presence: [{ id: 'old-base', elementId: 'mara', placeId: 'hafen' }, { id: 'old-trial', elementId: 'mara', placeId: 'hafen', momentId: 'trial' }],
    };
    const result = applyAssistantProposals(state, [{ kind: 'set_presence', elementId: 'mara', placeId: 'archiv', momentId: 'trial' }], t);
    expect(result.presence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-base', placeId: 'hafen' }),
      expect.objectContaining({ elementId: 'mara', placeId: 'archiv', momentId: 'trial' }),
    ]));
    expect(result.presence).not.toContainEqual(expect.objectContaining({ id: 'old-trial' }));
  });
});
