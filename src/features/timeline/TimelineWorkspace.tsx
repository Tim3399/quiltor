import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Clock3, Plus, Redo2, Skull, Trash2, Undo2 } from 'lucide-react';
import type { FigureEdge, FigureNode, FigureState, TimelineMoment } from '../../types';
import { uid } from '../../types';
import { ConfirmDialog, DELETE_HOLD_MS } from '../../shared/ui/ConfirmDialog';
import { patchRelationship, relationshipLabelEditor, resolveRelationship } from '../figures/relationships';
import { patchPresence } from '../figures/presence';
import { PresenceBoard } from './PresenceBoard';
import { useLanguage } from '../../language';
import './TimelineWorkspace.css';

export function TimelineWorkspace({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false }: {
  state: FigureState; onChange: (value: FigureState) => void; targetId?: string;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
}) {
  const { t } = useLanguage();
  const timeline = state.timeline || [];
  const [selectedId, setSelectedId] = useState<string | null>(() => targetId || timeline[0]?.id || null);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const selected = timeline.find(moment => moment.id === selectedId) || null;
  useEffect(() => { if (targetId && timeline.some(moment => moment.id === targetId)) setSelectedId(targetId); }, [targetId, timeline]);
  useEffect(() => { if (!selectedId && timeline.length) setSelectedId(timeline[0].id); }, [selectedId, timeline]);

  const addMoment = () => {
    const moment: TimelineMoment = { id: uid('t'), title: t('newMoment') };
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

  return <section className="timeline-workspace" aria-label={t('timelineManageLabel')}>
    <div className="context-bar">
      <div className="context-title"><strong>{t('timelineNav')}</strong><span>{timeline.length} {t('moments')} · {state.edges.length} {t('relationships')}</span></div>
      <div className="tool-group"><button className="primary" onClick={addMoment}><Plus />{t('momentKind')}</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label={t('undoTimeline')}><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label={t('redoTimeline')}><Redo2 /></button></div>
    </div>
    <div className="timeline-manager-layout">
      <aside className="timeline-moment-list" aria-label={t('moments')}>
        <div className="panel-heading"><span>{t('moments')}</span><Clock3 /></div>
        <div className="timeline-moment-items">{timeline.map((moment, index) => <button key={moment.id} className={moment.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(moment.id)}><span>{index + 1}</span><strong>{moment.title || t('untitled')}</strong><small>{moment.date || t('noDate')}</small></button>)}</div>
        {!timeline.length && <div className="timeline-manager-empty"><Clock3 /><p>{t('emptyTimelineHint')}</p><button onClick={addMoment}><Plus />{t('createFirstMoment')}</button></div>}
      </aside>
      <main className="timeline-manager-main">
        {!selected ? <div className="timeline-manager-empty"><Clock3 /><h2>{t('noTimelineYet')}</h2><p>{t('timelineIntro')}</p><button onClick={addMoment}><Plus />{t('createMoment')}</button></div> : <>
          <header className="timeline-editor-header"><div><span>{t('momentNumberLabel').replace('{n}', String(timeline.findIndex(moment => moment.id === selected.id) + 1))}</span><h1>{selected.title || t('untitled')}</h1><small>{t('changesAtMoment').replace('{n}', String(changes))}</small></div><div><button disabled={timeline[0]?.id === selected.id} onClick={() => moveMoment(-1)} title={t('moveEarlierHelp')}><ArrowUp />{t('earlier')}</button><button disabled={timeline.at(-1)?.id === selected.id} onClick={() => moveMoment(1)} title={t('moveLaterHelp')}><ArrowDown />{t('later')}</button><button className="danger-text" onClick={() => setDeleteMoment(selected)}><Trash2 />{t('delete')}</button></div></header>
          <section className="timeline-meta-card"><label className="field"><span>{t('name')}</span><input value={selected.title} onChange={event => patchMoment({ title: event.target.value })} /></label><label className="field"><span>{t('optionalDate')}</span><input type="date" value={selected.date || ''} onChange={event => patchMoment({ date: event.target.value || undefined })} /></label><label className="field timeline-note"><span>{t('optionalNote')}</span><textarea value={selected.note || ''} placeholder={t('momentNoteQuestion')} onChange={event => patchMoment({ note: event.target.value })} /></label></section>
          <ManagerSection title={t('relationships')} description={t('relationshipsSectionDescription')}>
            <div className="timeline-relation-table">{state.edges.map(edge => <RelationshipRow key={edge.id} edge={edge} nodes={state.nodes} timeline={timeline} momentId={selected.id} onPatch={patch => patchEdge(edge, patch)} />)}{!state.edges.length && <p className="timeline-section-empty">{t('noRelationshipsInBoard')}</p>}</div>
          </ManagerSection>
          <ManagerSection title={t('lifeEventsSection')} description={t('lifeEventsSectionDescription')}>
            <div className="timeline-life-grid">{lifeNodes.map(node => <label key={node.id}><input type="checkbox" checked={node.diedMomentId === selected.id} onChange={event => onChange({ ...state, nodes: state.nodes.map(item => item.id === node.id ? { ...item, diedMomentId: event.target.checked ? selected.id : undefined } : item) })} /><Skull /><span><strong>{node.name}</strong><small>{node.type === 'tier' ? t('animal') : t('figure')}</small></span></label>)}{!lifeNodes.length && <p className="timeline-section-empty">{t('noFiguresOrAnimalsYet')}</p>}</div>
          </ManagerSection>
          <ManagerSection title={t('presenceSection')} description={t('presenceSectionDescription')}>
            <PresenceBoard nodes={lifeNodes} places={places} presence={presence} timeline={timeline} momentId={selected.id} onPatch={patchPresenceAt} />
          </ManagerSection>
        </>}
      </main>
    </div>
    {deleteMoment && <ConfirmDialog title={t('deleteTimeMoment')} description={t('deleteMomentDescription').replace('{title}', deleteMoment.title)} confirmLabel={t('deleteTimeMoment')} holdDurationMs={DELETE_HOLD_MS} onClose={() => setDeleteMoment(null)} onConfirm={() => { const remaining = timeline.filter(moment => moment.id !== deleteMoment.id); onChange({ ...state, timeline: remaining, edges: state.edges.map(edge => ({ ...edge, versions: edge.versions?.filter(version => version.momentId !== deleteMoment.id) })), nodes: state.nodes.map(node => node.diedMomentId === deleteMoment.id ? { ...node, diedMomentId: undefined } : node), presence: presence.filter(entry => entry.momentId !== deleteMoment.id) }); setSelectedId(remaining[0]?.id || null); setDeleteMoment(null); }} />}
  </section>;
}

function ManagerSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="timeline-manager-section"><header><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}

function RelationshipRow({ edge, nodes, timeline, momentId, onPatch }: { edge: FigureEdge; nodes: FigureNode[]; timeline: TimelineMoment[]; momentId: string; onPatch: (patch: Partial<FigureEdge>) => void }) {
  const { t } = useLanguage();
  const resolved = resolveRelationship(edge, timeline, momentId);
  const labelEditor = relationshipLabelEditor(edge, timeline, momentId);
  const from = nodes.find(node => node.id === resolved.from), to = nodes.find(node => node.id === resolved.to);
  return <div className={!resolved.active ? 'inactive' : ''}>
    <label className="timeline-active"><input type="checkbox" checked={resolved.active} onChange={event => onPatch({ active: event.target.checked })} /><span>{t('active')}</span></label>
    <div className="timeline-endpoints"><strong>{from?.name || t('unknown')}</strong>{resolved.gerichtet ? <button aria-label={t('reverseDirectionBetween').replace('{from}', from?.name || t('element')).replace('{to}', to?.name || t('element'))} title={t('reverseDirection')} onClick={() => onPatch({ from: resolved.to, to: resolved.from })}><ArrowLeftRight /></button> : <span aria-label={t('undirected')}>↔</span>}<strong>{to?.name || t('unknown')}</strong></div>
    <label className="relationship-label-editor"><span className="sr-only">{t('labelForXAndY').replace('{from}', from?.name || t('element')).replace('{to}', to?.name || t('element'))}</span><input aria-label={t('labelForXAndY').replace('{from}', from?.name || t('element')).replace('{to}', to?.name || t('element'))} value={labelEditor.value} placeholder={labelEditor.inherited || t('relationshipWord')} disabled={!resolved.active} onChange={event => onPatch({ label: event.target.value })} /></label>
    <label className="timeline-directed"><input type="checkbox" checked={!!resolved.gerichtet} disabled={!resolved.active} onChange={event => onPatch({ gerichtet: event.target.checked })} /><span>{t('directed')}</span></label>
  </div>;
}
