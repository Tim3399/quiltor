import type { FigureNode } from '../../types';

export type EntitySpan = { start: number; end: number; id: string; kind: string; info: string };

const KIND_LABEL: Record<string, string> = {
  person: 'Figur', tier: 'Tier', ort: 'Ort', organisation: 'Organisation', objekt: 'Objekt', konzept: 'Konzept',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityInfo(node: FigureNode): string {
  const parts = [`${(node.type && KIND_LABEL[node.type]) || 'Element'}: ${node.name}`];
  if (node.label) parts.push(node.label);
  if (node.sub) parts.push(node.sub);
  return parts.join(' · ');
}

// Find every whole-word mention of an existing element's name in the chapter text. Longer names
// win over shorter ones (so "Priorin Elian" isn't split), and overlapping matches are skipped, so
// each character belongs to at most one mention. Purely lexical and exact -- no fuzzy guessing, to
// avoid marking words that aren't really the entity.
export function detectEntities(text: string, nodes: FigureNode[]): EntitySpan[] {
  if (!text) return [];
  const named = nodes
    .filter(node => (node.name || '').trim().length >= 3)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  const taken = new Uint8Array(text.length);
  const spans: EntitySpan[] = [];
  for (const node of named) {
    const name = node.name.trim();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');
    while ((match = pattern.exec(text))) {
      const start = match.index;
      const end = start + name.length;
      let free = true;
      for (let i = start; i < end; i++) if (taken[i]) { free = false; break; }
      if (!free) continue;
      for (let i = start; i < end; i++) taken[i] = 1;
      spans.push({ start, end, id: node.id, kind: node.type || 'person', info: entityInfo(node) });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
