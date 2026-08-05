import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Clock3, Plus, Redo2, Skull, Trash2, Undo2 } from 'lucide-react';
import type { FigureEdge, FigureNode, FigureState, TimelineMoment } from '../../types';
import { uid } from '../../types';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { patchRelationship, relationshipLabelEditor, resolveRelationship } from '../figures/FigureWorkspace';
import { patchPresence } from '../figures/presence';
import { PresenceBoard } from './PresenceBoard';
import './TimelineWorkspace.css';

export function TimelineWorkspace({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false }: {
  state: FigureState; onChange: (value: FigureState) => void; targetId?: string;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
}) {
  const timeline = state.timeline || [];
  const [selectedId, setSelectedId] = useState<string | null>(() => targetId || timeline[0]?.id || null);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const selected = timeline.find(moment => moment.id === selectedId) || null;
  useEffect(() => { if (targetId && timeline.some(moment => moment.id === targetId)) setSelectedId(targetId); }, [targetId, timeline]);
  useEffect(() => { if (!selectedId && timeline.length) setSelectedId(timeline[0].id); }, [selectedId, timeline]);

  const addMoment = () => {
    const moment: TimelineMoment = { id: uid('t'), title: 'Neuer Zeitpunkt' };
    onChange({ ...state, timeline: [...timeline, moment] });
    setSelectedId(moment.id);
  };
  const patchMoment = (patch: Partial<TimelineMoment>) => selected && onChange({ ...state, timeline: timeline.map(moment => moment.id === selected.id ? { ...moment, ...patch } : moment) });
  const moveMoment = (offset: number) => {
    if (!selected) return;
    const index = timeline.findIndex(moment => moment.id === selected.id), target = index + offset;
    if (target < 0 || target >= timeline.length) return;
    const next = [...timeline]; [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...state, timeline: next });
  };
  const patchEdge = (edge: FigureEdge, patch: Partial<FigureEdge>) => {
    if (!selected) return;
    onChange({ ...state, edges: state.edges.map(item => item.id === edge.id ? patchRelationship(item, timeline, selected.id, patch) : item) });
  };
  const lifeNodes = useMemo(() => state.nodes.filter(node => node.type === 'person' || node.type === 'tier'), [state.nodes]);
  const places = useMemo(() => state.nodes.filter(node => node.type === 'ort'), [state.nodes]);
  const presence = state.presence ?? [];
  const patchPresenceAt = (nodeId: string, placeId: string) => selected && onChange({ ...state, presence: patchPresence(presence, nodeId, selected.id, placeId || null) });
  const changes = selected ? state.edges.filter(edge => edge.versions?.some(version => version.momentId === selected.id)).length + state.nodes.filter(node => node.diedMomentId === selected.id).length + presence.filter(entry => entry.momentId === selected.id).length : 0;

  return <section className="timeline-workspace" aria-label="Timeline verwalten">
    <div className="context-bar">
      <div className="context-title"><strong>Timeline</strong><span>{timeline.length} Zeitpunkte · {state.edges.length} Beziehungen</span></div>
      <div className="tool-group"><button className="primary" onClick={addMoment}><Plus />Zeitpunkt</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label="Timeline rückgängig"><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label="Timeline wiederholen"><Redo2 /></button></div>
    </div>
    <div className="timeline-manager-layout">
      <aside className="timeline-moment-list" aria-label="Zeitpunkte">
        <div className="panel-heading"><span>Zeitpunkte</span><Clock3 /></div>
        <div className="timeline-moment-items">{timeline.map((moment, index) => <button key={moment.id} className={moment.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(moment.id)}><span>{index + 1}</span><strong>{moment.title || 'Ohne Titel'}</strong><small>{moment.date || 'Kein Datum'}</small></button>)}</div>
        {!timeline.length && <div className="timeline-manager-empty"><Clock3 /><p>Lege den ersten Zeitpunkt an, um Beziehungen über die Zeit zu verwalten.</p><button onClick={addMoment}><Plus />Ersten Zeitpunkt anlegen</button></div>}
      </aside>
      <main className="timeline-manager-main">
        {!selected ? <div className="timeline-manager-empty"><Clock3 /><h2>Noch keine Timeline</h2><p>Zeitpunkte bilden die Zustände deiner Welt ab. Die Reihenfolge hier steuert auch die Animation im Figurenboard.</p><button onClick={addMoment}><Plus />Zeitpunkt anlegen</button></div> : <>
          <header className="timeline-editor-header"><div><span>Zeitpunkt {timeline.findIndex(moment => moment.id === selected.id) + 1}</span><h1>{selected.title || 'Ohne Titel'}</h1><small>{changes} Änderungen an diesem Zeitpunkt</small></div><div><button disabled={timeline[0]?.id === selected.id} onClick={() => moveMoment(-1)} title="Früher einordnen"><ArrowUp />Früher</button><button disabled={timeline.at(-1)?.id === selected.id} onClick={() => moveMoment(1)} title="Später einordnen"><ArrowDown />Später</button><button className="danger-text" onClick={() => setDeleteMoment(selected)}><Trash2 />Löschen</button></div></header>
          <section className="timeline-meta-card"><label className="field"><span>Name</span><input value={selected.title} onChange={event => patchMoment({ title: event.target.value })} /></label><label className="field"><span>Datum · optional</span><input type="date" value={selected.date || ''} onChange={event => patchMoment({ date: event.target.value || undefined })} /></label><label className="field timeline-note"><span>Notiz · optional</span><textarea value={selected.note || ''} placeholder="Was verändert sich an diesem Zeitpunkt?" onChange={event => patchMoment({ note: event.target.value })} /></label></section>
          <ManagerSection title="Beziehungen" description="Hier änderst du ausschließlich den Zustand am ausgewählten Zeitpunkt.">
            <div className="timeline-relation-table">{state.edges.map(edge => <RelationshipRow key={edge.id} edge={edge} nodes={state.nodes} timeline={timeline} momentId={selected.id} onPatch={patch => patchEdge(edge, patch)} />)}{!state.edges.length && <p className="timeline-section-empty">Noch keine Beziehungen im Figurenboard.</p>}</div>
          </ManagerSection>
          <ManagerSection title="Lebensereignisse" description="Markiere, welche Figuren oder Tiere an diesem Zeitpunkt sterben.">
            <div className="timeline-life-grid">{lifeNodes.map(node => <label key={node.id}><input type="checkbox" checked={node.diedMomentId === selected.id} onChange={event => onChange({ ...state, nodes: state.nodes.map(item => item.id === node.id ? { ...item, diedMomentId: event.target.checked ? selected.id : undefined } : item) })} /><Skull /><span><strong>{node.name}</strong><small>{node.type === 'tier' ? 'Tier' : 'Figur'}</small></span></label>)}{!lifeNodes.length && <p className="timeline-section-empty">Noch keine Figuren oder Tiere vorhanden.</p>}</div>
          </ManagerSection>
          <ManagerSection title="Anwesenheit" description="Ziehe eine Figur oder ein Tier auf einen Ort, um die Anwesenheit an diesem Zeitpunkt zu setzen.">
            <PresenceBoard nodes={lifeNodes} places={places} presence={presence} timeline={timeline} momentId={selected.id} onPatch={patchPresenceAt} />
          </ManagerSection>
        </>}
      </main>
    </div>
    {deleteMoment && <ConfirmDialog title="Zeitpunkt löschen" description={`„${deleteMoment.title}“ und die dort gespeicherten Zustandsänderungen werden entfernt. Rückgängig machen geht mit ⌘Z.`} confirmLabel="Zeitpunkt löschen" onClose={() => setDeleteMoment(null)} onConfirm={() => { const remaining = timeline.filter(moment => moment.id !== deleteMoment.id); onChange({ ...state, timeline: remaining, edges: state.edges.map(edge => ({ ...edge, versions: edge.versions?.filter(version => version.momentId !== deleteMoment.id) })), nodes: state.nodes.map(node => node.diedMomentId === deleteMoment.id ? { ...node, diedMomentId: undefined } : node), presence: presence.filter(entry => entry.momentId !== deleteMoment.id) }); setSelectedId(remaining[0]?.id || null); setDeleteMoment(null); }} />}
  </section>;
}

function ManagerSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="timeline-manager-section"><header><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}

function RelationshipRow({ edge, nodes, timeline, momentId, onPatch }: { edge: FigureEdge; nodes: FigureNode[]; timeline: TimelineMoment[]; momentId: string; onPatch: (patch: Partial<FigureEdge>) => void }) {
  const resolved = resolveRelationship(edge, timeline, momentId);
  const labelEditor = relationshipLabelEditor(edge, timeline, momentId);
  const from = nodes.find(node => node.id === resolved.from), to = nodes.find(node => node.id === resolved.to);
  return <div className={!resolved.active ? 'inactive' : ''}>
    <label className="timeline-active"><input type="checkbox" checked={resolved.active} onChange={event => onPatch({ active: event.target.checked })} /><span>Aktiv</span></label>
    <div className="timeline-endpoints"><strong>{from?.name || 'Unbekannt'}</strong>{resolved.gerichtet ? <button aria-label={`Richtung zwischen ${from?.name || 'Element'} und ${to?.name || 'Element'} umkehren`} title="Richtung umkehren" onClick={() => onPatch({ from: resolved.to, to: resolved.from })}><ArrowLeftRight /></button> : <span aria-label="Ungerichtet">↔</span>}<strong>{to?.name || 'Unbekannt'}</strong></div>
    <label className="relationship-label-editor"><span className="sr-only">Bezeichnung für {from?.name || 'Element'} und {to?.name || 'Element'}</span><input aria-label={`Bezeichnung für ${from?.name || 'Element'} und ${to?.name || 'Element'}`} value={labelEditor.value} placeholder={labelEditor.inherited || 'Beziehung'} disabled={!resolved.active} onChange={event => onPatch({ label: event.target.value })} /></label>
    <label className="timeline-directed"><input type="checkbox" checked={!!resolved.gerichtet} disabled={!resolved.active} onChange={event => onPatch({ gerichtet: event.target.checked })} /><span>Gerichtet</span></label>
  </div>;
}
