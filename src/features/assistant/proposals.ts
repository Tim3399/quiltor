import type { AssistantProposal, FigureEdge, FigureNode, FigureState, TimelineMoment } from '../../types';
import { uid } from '../../types';
import type { MessageKey } from '../../language';

const GRID_X = 288, GRID_Y = 192;

function gridPosition(index: number): { x: number; y: number } {
  return { x: 96 + (index % 4) * GRID_X, y: 96 + Math.floor(index / 4) * GRID_Y };
}

export function applyAssistantProposals(state: FigureState, proposals: AssistantProposal[], t: (key: MessageKey) => string): FigureState {
  const next: FigureState = structuredClone(state);
  next.timeline ||= [];
  const references = new Map<string, string>();
  const resolve = (value: string) => references.get(value) || (value.startsWith('new:') ? proposalId(value, value.includes(':moment:') ? 't' : 'n') : value);
  for (const proposal of proposals) {
    if (proposal.kind === 'create_element') {
      const id = proposalId(proposal.tempId, 'n');
      references.set(proposal.tempId, id);
      if (next.nodes.some(node => node.id === id)) continue;
      const index = next.nodes.length;
      const element = proposal.element;
      const node: FigureNode = {
        id, ...gridPosition(index),
        type: ['ort', 'konzept', 'tier', 'organisation', 'objekt'].includes(element.type || '') ? element.type : 'person',
        name: String(element.name || t('defaultElementName')).slice(0, 160), label: String(element.label || '').slice(0, 160),
        sub: String(element.sub || '').slice(0, 1000), accent: 'ink', profile: sanitizeProfile(element.profile),
      };
      next.nodes.push(node);
    } else if (proposal.kind === 'update_element') {
      const id = resolve(proposal.elementId);
      next.nodes = next.nodes.map(node => node.id === id ? { ...node,
        ...(typeof proposal.patch.name === 'string' ? { name: proposal.patch.name.slice(0, 160) } : {}),
        ...(typeof proposal.patch.label === 'string' ? { label: proposal.patch.label.slice(0, 160) } : {}),
        ...(typeof proposal.patch.sub === 'string' ? { sub: proposal.patch.sub.slice(0, 1000) } : {}),
        ...(proposal.patch.profile ? { profile: { ...(node.profile || {}), ...sanitizeProfile(proposal.patch.profile) } } : {}),
      } : node);
    } else if (proposal.kind === 'create_timeline_moment') {
      const id = proposalId(proposal.tempId, 't');
      references.set(proposal.tempId, id);
      if (next.timeline.some(moment => moment.id === id)) continue;
      const moment: TimelineMoment = { id, title: String(proposal.moment.title || t('newMoment')).slice(0, 160) };
      if (proposal.moment.date) moment.date = String(proposal.moment.date).slice(0, 20);
      if (proposal.moment.note) moment.note = String(proposal.moment.note).slice(0, 1000);
      next.timeline.push(moment);
    } else if (proposal.kind === 'create_relationship') {
      const from = resolve(proposal.relationship.from), to = resolve(proposal.relationship.to);
      if (!next.nodes.some(node => node.id === from) || !next.nodes.some(node => node.id === to) || from === to) continue;
      const directed = !!proposal.relationship.directed;
      const duplicate = next.edges.some(edge => directed ? edge.from === from && edge.to === to && !!edge.gerichtet : !edge.gerichtet && new Set([edge.from, edge.to]).has(from) && new Set([edge.from, edge.to]).has(to));
      if (duplicate) continue;
      next.edges.push({ id: uid('e'), from, to, label: String(proposal.relationship.label || '').slice(0, 160), gerichtet: directed, style: safeStyle(proposal.relationship.style) });
    } else if (proposal.kind === 'set_relationship_at_moment') {
      const relationshipId = resolve(proposal.relationshipId), momentId = resolve(proposal.momentId);
      if (!next.timeline.some(moment => moment.id === momentId)) continue;
      next.edges = next.edges.map(edge => {
        if (edge.id !== relationshipId) return edge;
        const current = edge.versions?.find(version => version.momentId === momentId);
        const version = { momentId, label: proposal.patch.label ?? current?.label ?? edge.label, active: proposal.patch.active ?? current?.active ?? true, gerichtet: proposal.patch.directed ?? current?.gerichtet ?? edge.gerichtet, style: safeStyle(proposal.patch.style ?? current?.style ?? edge.style) };
        return { ...edge, versions: [...(edge.versions || []).filter(item => item.momentId !== momentId), version] };
      });
    } else if (proposal.kind === 'mark_deceased') {
      const elementId = resolve(proposal.elementId), momentId = resolve(proposal.momentId);
      if (next.timeline.some(moment => moment.id === momentId)) next.nodes = next.nodes.map(node => node.id === elementId ? { ...node, diedMomentId: momentId } : node);
    } else if (proposal.kind === 'set_presence') {
      const elementId = resolve(proposal.elementId), placeId = resolve(proposal.placeId), momentId = proposal.momentId ? resolve(proposal.momentId) : undefined;
      if (!next.nodes.some(node => node.id === elementId) || !next.nodes.some(node => node.id === placeId && node.type === 'ort') || (momentId && !next.timeline.some(moment => moment.id === momentId))) continue;
      next.presence ||= [];
      next.presence = [...next.presence.filter(entry => !(entry.elementId === elementId && (entry.momentId || undefined) === momentId)), { id: uid('p'), elementId, placeId, ...(momentId ? { momentId } : {}) }];
    } else if (proposal.kind === 'arrange_elements') {
      next.nodes = arrangeNodes(next.nodes, next.edges, proposal.strategy);
    }
  }
  return next;
}

function proposalId(value: string, prefix: 'n' | 't') {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${prefix}ai${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function scopeAssistantProposals(proposals: AssistantProposal[], scope: string): AssistantProposal[] {
  const scoped = (value: string) => value.startsWith('new:') ? `new:${value.startsWith('new:moment:') ? 'moment:' : ''}${scope}:${value.replace(/^new:(moment:)?/, '')}` : value;
  return proposals.map(proposal => {
    if (proposal.kind === 'create_element' || proposal.kind === 'create_timeline_moment') return { ...proposal, tempId: scoped(proposal.tempId) };
    if (proposal.kind === 'create_relationship') return { ...proposal, relationship: { ...proposal.relationship, from: scoped(proposal.relationship.from), to: scoped(proposal.relationship.to) } };
    if (proposal.kind === 'set_relationship_at_moment') return { ...proposal, relationshipId: scoped(proposal.relationshipId), momentId: scoped(proposal.momentId) };
    if (proposal.kind === 'mark_deceased') return { ...proposal, elementId: scoped(proposal.elementId), momentId: scoped(proposal.momentId) };
    if (proposal.kind === 'set_presence') return { ...proposal, elementId: scoped(proposal.elementId), placeId: scoped(proposal.placeId), ...(proposal.momentId ? { momentId: scoped(proposal.momentId) } : {}) };
    return proposal;
  });
}

function sanitizeProfile(profile?: Record<string, unknown>) {
  if (!profile) return { extra: [] };
  const text = (key: string) => typeof profile[key] === 'string' ? String(profile[key]).slice(0, 4000) : undefined;
  return { alter: text('alter'), rolle: text('rolle'), aussehen: text('aussehen'), herkunft: text('herkunft'), stimme: text('stimme'), notizen: text('notizen'), extra: [] };
}

function safeStyle(style?: FigureEdge['style']): FigureEdge['style'] {
  return style === 'dashed' || style === 'blood' || style === 'gold' ? style : 'solid';
}

function arrangeNodes(nodes: FigureNode[], edges: FigureEdge[], strategy: 'thematic' | 'grid') {
  if (strategy === 'grid') return nodes.map((node, index) => ({ ...node, ...gridPosition(index) }));
  const remaining = new Set(nodes.map(node => node.id));
  const neighbours = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) { neighbours.get(edge.from)?.add(edge.to); neighbours.get(edge.to)?.add(edge.from); }
  const groups: FigureNode[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as string, queue = [first], ids: string[] = [];
    remaining.delete(first);
    while (queue.length) { const id = queue.shift()!; ids.push(id); for (const neighbour of neighbours.get(id) || []) if (remaining.delete(neighbour)) queue.push(neighbour); }
    groups.push(ids.map(id => nodes.find(node => node.id === id)!).sort((a, b) => (b.type === 'person' ? 1 : 0) - (a.type === 'person' ? 1 : 0) || a.name.localeCompare(b.name)));
  }
  groups.sort((a, b) => b.length - a.length);
  const positioned = new Map<string, { x: number; y: number }>(); let originX = 96, originY = 96, rowHeight = 0;
  for (const group of groups) {
    const columns = Math.min(3, group.length), width = Math.max(1, columns) * GRID_X, rows = Math.ceil(group.length / columns), height = rows * GRID_Y;
    if (originX > 96 && originX + width > 1248) { originX = 96; originY += rowHeight + GRID_Y; rowHeight = 0; }
    group.forEach((node, index) => positioned.set(node.id, { x: originX + (index % columns) * GRID_X, y: originY + Math.floor(index / columns) * GRID_Y }));
    originX += width + GRID_X; rowHeight = Math.max(rowHeight, height);
  }
  return nodes.map(node => ({ ...node, ...positioned.get(node.id)! }));
}

export function proposalLabel(proposal: AssistantProposal, state: FigureState, t: (key: MessageKey) => string) {
  const nodeName = (id: string) => state.nodes.find(node => node.id === id)?.name || id.replace('new:', `${t('newPrefix')}: `);
  if (proposal.kind === 'create_element') return t('createElementLabel').replace('{name}', proposal.element.name || t('withoutName'));
  if (proposal.kind === 'update_element') return t('updateElementLabel').replace('{name}', nodeName(proposal.elementId));
  if (proposal.kind === 'create_timeline_moment') return t('createMomentLabel').replace('{title}', proposal.moment.title || t('untitled'));
  if (proposal.kind === 'create_relationship') return t('createRelationshipLabel').replace('{from}', nodeName(proposal.relationship.from)).replace('{to}', nodeName(proposal.relationship.to));
  if (proposal.kind === 'set_relationship_at_moment') return t('updateRelationshipStateLabel').replace('{label}', proposal.patch.label || t('statusFallback'));
  if (proposal.kind === 'arrange_elements') return t('rearrangeElementsLabel');
  if (proposal.kind === 'set_presence') return `${nodeName(proposal.elementId)} → ${nodeName(proposal.placeId)}`;
  return t('setDeathMomentLabel').replace('{name}', nodeName(proposal.elementId));
}
