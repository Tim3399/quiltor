import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, GripVertical, MoreHorizontal, Plus, Redo2, Skull, Trash2, Undo2, X } from 'lucide-react';
import type { FigureEdge, FigureNode, FigureState, TimelineMoment } from '../../types';
import { uid } from '../../types';
import { ConfirmDialog, DELETE_HOLD_MS } from '../../shared/ui/ConfirmDialog';
import { Menu, MenuItem, MenuSeparator } from '../../shared/ui/Menu';
import { Popover } from '../../shared/ui/Popover';
import { Sheet } from '../../shared/ui/Sheet';
import { patchRelationship, relationshipLabelEditor, resolveRelationship } from '../figures/relationships';
import { patchPresence } from '../figures/presence';
import { PresenceBoard } from './PresenceBoard';
import { useLanguage, type Translate } from '../../language';
import './TimelineWorkspace.css';

type BoardMode = 'changes' | 'state';

export function TimelineWorkspace({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false }: {
  state: FigureState; onChange: (value: FigureState) => void; targetId?: string;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
}) {
  const { t } = useLanguage();
  const timeline = state.timeline || [];
  const [selectedId, setSelectedId] = useState<string | null>(() => targetId || timeline[0]?.id || null);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [draggedMomentId, setDraggedMomentId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>('changes');
  const [openSections, setOpenSections] = useState(() => new Set(['relationships']));
  const [selectedLifeId, setSelectedLifeId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 719px)').matches);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const selected = timeline.find(moment => moment.id === selectedId) || null;
  const selectedIndex = selected ? timeline.findIndex(moment => moment.id === selected.id) : -1;

  useEffect(() => { if (targetId && timeline.some(moment => moment.id === targetId)) setSelectedId(targetId); }, [targetId, timeline]);
  useEffect(() => { if (!selectedId && timeline.length) setSelectedId(timeline[0].id); }, [selectedId, timeline]);
  useEffect(() => setSelectedEdgeId(null), [selectedId]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(max-width: 719px)'), update = () => setCompact(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const addMomentAt = (index: number) => {
    const moment: TimelineMoment = { id: uid('t'), title: t('timelineNew') };
    const next = [...timeline]; next.splice(index, 0, moment);
    onChange({ ...state, timeline: next }); setSelectedId(moment.id);
  };
  const patchMoment = (patch: Partial<TimelineMoment>) => selected && onChange({ ...state, timeline: timeline.map(moment => moment.id === selected.id ? { ...moment, ...patch } : moment) });
  const moveMomentTo = (momentId: string, targetIndex: number) => {
    const from = timeline.findIndex(moment => moment.id === momentId);
    if (from < 0) return;
    const next = [...timeline], [moment] = next.splice(from, 1);
    const adjusted = Math.max(0, Math.min(next.length, targetIndex > from ? targetIndex - 1 : targetIndex));
    next.splice(adjusted, 0, moment); onChange({ ...state, timeline: next }); setSelectedId(moment.id);
  };
  const moveMoment = (offset: number) => selected && moveMomentTo(selected.id, selectedIndex + offset + (offset > 0 ? 1 : 0));
  const duplicateMoment = () => {
    if (!selected) return;
    const copy = { ...selected, id: uid('t'), title: t('timelineCopyName', { name: selected.title || t('timelineUntitled') }) };
    const next = [...timeline]; next.splice(selectedIndex + 1, 0, copy);
    onChange({
      ...state,
      timeline: next,
      edges: state.edges.map(edge => ({ ...edge, versions: [...(edge.versions || []), ...(edge.versions || []).filter(version => version.momentId === selected.id).map(version => ({ ...version, momentId: copy.id }))] })),
      nodes: state.nodes,
      presence: [...presence, ...presence.filter(entry => entry.momentId === selected.id).map(entry => ({ ...entry, momentId: copy.id }))],
    }); setSelectedId(copy.id); setActionsOpen(false);
  };
  const patchEdge = (edge: FigureEdge, patch: Partial<FigureEdge>) => selected && onChange({ ...state, edges: state.edges.map(item => item.id === edge.id ? patchRelationship(item, timeline, selected.id, patch) : item) });
  const removeEdgeChange = (edge: FigureEdge) => selected && onChange({ ...state, edges: state.edges.map(item => item.id === edge.id ? { ...item, versions: item.versions?.filter(version => version.momentId !== selected.id) } : item) });

  const lifeNodes = useMemo(() => state.nodes.filter(node => node.type === 'person' || node.type === 'tier'), [state.nodes]);
  const places = useMemo(() => state.nodes.filter(node => node.type === 'ort'), [state.nodes]);
  const presence = state.presence ?? [];
  const patchPresenceAt = (nodeId: string, placeId: string) => selected && onChange({ ...state, presence: patchPresence(presence, nodeId, selected.id, placeId || null) });
  const edgeChanges = selected ? state.edges.filter(edge => edge.versions?.some(version => version.momentId === selected.id)) : [];
  const presenceChanges = selected ? presence.filter(entry => entry.momentId === selected.id) : [];
  const lifeChanges = selected ? lifeNodes.filter(node => node.diedMomentId === selected.id) : [];
  const changes = edgeChanges.length + presenceChanges.length + lifeChanges.length;
  const visibleEdges = mode === 'changes' ? edgeChanges : state.edges;
  const selectedEdge = state.edges.find(edge => edge.id === selectedEdgeId) || null;
  const addRelationshipChange = (edgeId: string) => {
    const edge = state.edges.find(item => item.id === edgeId);
    if (!edge || !selected) return;
    patchEdge(edge, {}); setSelectedEdgeId(edge.id);
  };
  const markDeath = (nodeId: string) => {
    if (!selected) return;
    onChange({ ...state, nodes: state.nodes.map(node => node.id === nodeId ? { ...node, diedMomentId: node.diedMomentId === selected.id ? undefined : selected.id } : node) });
    setSelectedLifeId(null);
  };
  const toggleSection = (section: string) => setOpenSections(current => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });

  return <section className="timeline-workspace" aria-label={t('timeline')}>
    <div className="context-bar"><div className="context-title"><strong>{t('timeline')}</strong><span>{timeline.length} {t('timelinePoints')} · {state.edges.length} {t('timelineRelations')}</span></div><div className="context-tools">
      <div className="tool-group"><button className="primary" onClick={() => addMomentAt(selectedIndex >= 0 ? selectedIndex + 1 : timeline.length)}><Plus />{t('timelineAdd')}</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label={t('timelineUndo')}><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label={t('timelineRedo')}><Redo2 /></button></div>
    </div></div>

    {!timeline.length ? <div className="timeline-manager-empty"><Clock3 /><h2>{t('timelineEmptyTitle')}</h2><p>{t('timelineEmptyHelp')}</p><button onClick={() => addMomentAt(0)}><Plus />{t('timelineFirst')}</button></div> : <>
      <nav className="story-timeline" aria-label={t('timelineRail')}>
        <div className="story-track"><InsertMomentButton label={t('timelineInsertStart')} onClick={() => addMomentAt(0)} />
          {timeline.map((moment, index) => <div className="story-moment-wrap" key={moment.id}>
            <button draggable className={`story-moment ${moment.id === selectedId ? 'active' : ''}`} aria-current={moment.id === selectedId ? 'step' : undefined}
              onDragStart={() => setDraggedMomentId(moment.id)} onDragEnd={() => setDraggedMomentId(null)}
              onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (draggedMomentId) moveMomentTo(draggedMomentId, index); setDraggedMomentId(null); }}
              onClick={() => setSelectedId(moment.id)}>
              <GripVertical aria-hidden="true" /><span>{index + 1}</span><strong>{moment.title || t('timelineUntitled')}</strong><small>{moment.date || `${countMomentChanges(state, moment.id)} ${t('timelineChanges')}`}</small>
            </button>
            <InsertMomentButton label={t('timelineInsertAfter', { title: moment.title || String(index + 1) })} onClick={() => addMomentAt(index + 1)} />
          </div>)}
        </div>
      </nav>

      {selected && <div className={`storyboard-layout ${selectedEdge ? 'has-inspector' : ''}`}>
        <main className="storyboard-main">
          <header className="storyboard-header"><div className="storyboard-stepper"><button disabled={selectedIndex <= 0} onClick={() => setSelectedId(timeline[selectedIndex - 1]?.id)} aria-label={t('timelinePrevious')}><ChevronLeft /></button><span>{t('timelineOf', { current: selectedIndex + 1, total: timeline.length })}</span><button disabled={selectedIndex >= timeline.length - 1} onClick={() => setSelectedId(timeline[selectedIndex + 1]?.id)} aria-label={t('timelineNext')}><ChevronRight /></button></div>
            <div className="storyboard-title"><span>{t('timelinePoint', { number: selectedIndex + 1 })}</span><h1>{selected.title || t('timelineUntitled')}</h1><small>{t('timelineOwnChanges', { count: changes })}</small></div>
            <div className="storyboard-actions"><button ref={actionsButton} aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen(value => !value)}><MoreHorizontal />{t('menuActions')}</button><Popover anchorRef={actionsButton} open={actionsOpen} onClose={() => setActionsOpen(false)} label={t('timelineActions')}><Menu label={t('timelineActions')} onClose={() => setActionsOpen(false)}><MenuItem disabled={selectedIndex === 0} onSelect={() => { moveMoment(-1); setActionsOpen(false); }}><ArrowUp />{t('timelineEarlier')}</MenuItem><MenuItem disabled={selectedIndex === timeline.length - 1} onSelect={() => { moveMoment(1); setActionsOpen(false); }}><ArrowDown />{t('timelineLater')}</MenuItem><MenuItem onSelect={duplicateMoment}><Copy />{t('timelineDuplicate')}</MenuItem><MenuSeparator /><MenuItem onSelect={() => { setDeleteMoment(selected); setActionsOpen(false); }}><Trash2 />{t('timelineDelete')}</MenuItem></Menu></Popover></div>
          </header>

          <section className="timeline-meta-card"><label className="field"><span>{t('timelineName')}</span><input value={selected.title} onChange={event => patchMoment({ title: event.target.value })} /></label><label className="field"><span>{t('timelineDate')}</span><input type="date" value={selected.date || ''} onChange={event => patchMoment({ date: event.target.value || undefined })} /></label><label className="field timeline-note"><span>{t('timelineNote')}</span><textarea value={selected.note || ''} placeholder={t('timelineNotePlaceholder')} onChange={event => patchMoment({ note: event.target.value })} /></label></section>

          <ManagerSection id="relationships" title={t('relationships')} count={edgeChanges.length} description={mode === 'changes' ? t('timelineRelationsChanged') : t('timelineRelationsState')} open={openSections.has('relationships')} onToggle={() => toggleSection('relationships')}>
            <div className="storyboard-mode-row"><span>{t('timelineRelationshipView')}</span><div className="storyboard-mode" role="group" aria-label={t('timelineView')}><button aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>{t('timelineOnlyChanges')}</button><button aria-pressed={mode === 'state'} onClick={() => setMode('state')}>{t('timelineWholeState')}</button></div></div>
            <div className="relationship-add"><label><span className="sr-only">{t('timelineChangeRelation')}</span><select defaultValue="" onChange={event => { if (event.target.value) addRelationshipChange(event.target.value); event.target.value = ''; }}><option value="">{t('timelineChangeRelation')}</option>{state.edges.filter(edge => !edgeChanges.includes(edge)).map(edge => <option value={edge.id} key={edge.id}>{relationshipName(edge, state.nodes, timeline, selected.id, t)}</option>)}</select></label></div>
            <div className="relationship-change-list">{visibleEdges.map(edge => <RelationshipCard key={edge.id} edge={edge} nodes={state.nodes} timeline={timeline} momentId={selected.id} explicit={edgeChanges.includes(edge)} selected={edge.id === selectedEdgeId} onSelect={() => setSelectedEdgeId(edge.id)} t={t} />)}{!visibleEdges.length && <p className="timeline-section-empty">{t('timelineNoRelationChanges')}</p>}</div>
          </ManagerSection>

          <ManagerSection id="presence" title={t('timelinePresence')} count={presenceChanges.length} description={t('timelinePresenceHelp')} open={openSections.has('presence')} onToggle={() => toggleSection('presence')}>
            <PresenceBoard nodes={lifeNodes} places={places} presence={presence} timeline={timeline} momentId={selected.id} onPatch={patchPresenceAt} />
          </ManagerSection>

          <ManagerSection id="life" title={t('timelineLife')} count={lifeChanges.length} description={t('timelineLifeHelp')} open={openSections.has('life')} onToggle={() => toggleSection('life')}>
            <div className="life-event-board"><div className="life-event-roster">{lifeNodes.map(node => <button key={node.id} draggable className={selectedLifeId === node.id ? 'selected' : ''} aria-pressed={selectedLifeId === node.id} onDragStart={event => event.dataTransfer.setData('application/x-quiltor-life', node.id)} onClick={() => setSelectedLifeId(value => value === node.id ? null : node.id)}><strong>{node.name}</strong><small>{node.type === 'tier' ? t('animal') : t('figure')}</small></button>)}</div>
              <button className="death-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('application/x-quiltor-life'); if (id) markDeath(id); }} onClick={() => selectedLifeId && markDeath(selectedLifeId)}><Skull /><span><strong>{t('timelineDeathHere')}</strong><small>{selectedLifeId ? t('timelineDeathSelected') : t('timelineDeathHelp')}</small></span></button>
              {!!lifeChanges.length && <div className="life-change-list">{lifeChanges.map(node => <button key={node.id} onClick={() => markDeath(node.id)}><Skull /><span><strong>{node.name}</strong><small>{t('timelineRemoveDeath')}</small></span><X /></button>)}</div>}
            </div>
          </ManagerSection>
        </main>
        {selectedEdge && !compact && <RelationshipInspector edge={selectedEdge} nodes={state.nodes} timeline={timeline} momentId={selected.id} explicit={edgeChanges.includes(selectedEdge)} onPatch={patch => patchEdge(selectedEdge, patch)} onReset={() => { removeEdgeChange(selectedEdge); setSelectedEdgeId(null); }} onClose={() => setSelectedEdgeId(null)} t={t} />}
      </div>}
    </>}
    {selected && selectedEdge && compact && <Sheet open label={t('timelineRelation')} onClose={() => setSelectedEdgeId(null)}><RelationshipInspector edge={selectedEdge} nodes={state.nodes} timeline={timeline} momentId={selected.id} explicit={edgeChanges.includes(selectedEdge)} onPatch={patch => patchEdge(selectedEdge, patch)} onReset={() => { removeEdgeChange(selectedEdge); setSelectedEdgeId(null); }} onClose={() => setSelectedEdgeId(null)} t={t} /></Sheet>}
    {deleteMoment && <ConfirmDialog title={t('timelineDeleteTitle')} description={t('timelineDeleteDescription', { title: deleteMoment.title, count: countMomentChanges(state, deleteMoment.id) })} confirmLabel={t('timelineDeleteConfirm')} holdDurationMs={DELETE_HOLD_MS} onClose={() => setDeleteMoment(null)} onConfirm={() => { const remaining = timeline.filter(moment => moment.id !== deleteMoment.id); onChange({ ...state, timeline: remaining, edges: state.edges.map(edge => ({ ...edge, versions: edge.versions?.filter(version => version.momentId !== deleteMoment.id) })), nodes: state.nodes.map(node => node.diedMomentId === deleteMoment.id ? { ...node, diedMomentId: undefined } : node), presence: presence.filter(entry => entry.momentId !== deleteMoment.id) }); setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id || null); setDeleteMoment(null); }} />}
  </section>;
}

function InsertMomentButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="insert-moment" aria-label={label} title={label} onClick={onClick}><Plus /></button>;
}

function ManagerSection({ id, title, description, count, open, onToggle, children }: { id: string; title: string; description: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const panelId = `timeline-section-${id}`;
  return <section className={`timeline-manager-section ${open ? 'open' : ''}`}><header><button className="timeline-section-toggle" aria-label={title} aria-expanded={open} aria-controls={panelId} onClick={onToggle}><div><h2>{title}</h2><p>{description}</p></div><span className="timeline-section-summary"><span className="section-count">{count}</span><ChevronDown /></span></button></header>{open && <div id={panelId} className="timeline-section-body">{children}</div>}</section>;
}

function RelationshipCard({ edge, nodes, timeline, momentId, explicit, selected, onSelect, t }: { edge: FigureEdge; nodes: FigureNode[]; timeline: TimelineMoment[]; momentId: string; explicit: boolean; selected: boolean; onSelect: () => void; t: Translate }) {
  const current = resolveRelationship(edge, timeline, momentId);
  const index = timeline.findIndex(moment => moment.id === momentId);
  const before = index > 0 ? resolveRelationship(edge, timeline, timeline[index - 1].id) : { ...edge, active: edge.active !== false };
  const from = nodes.find(node => node.id === current.from), to = nodes.find(node => node.id === current.to);
  const changedLabel = explicit && before.label !== current.label;
  return <button className={`relationship-change-card ${selected ? 'selected' : ''} ${!current.active ? 'inactive' : ''}`} onClick={onSelect}><div className="relationship-card-main"><span className="change-badge">{explicit ? current.active ? t('timelineChange') : t('timelineEndsHere') : t('timelineInheritedBadge')}</span><strong>{from?.name || t('timelineUnknown')} <i>{current.gerichtet ? '→' : '↔'}</i> {to?.name || t('timelineUnknown')}</strong><small>{changedLabel ? t('timelineChangedLabel', { before: before.label || t('timelineNoLabel'), after: current.label || t('timelineNoLabel') }) : current.label || t('timelineWithoutLabel')}</small></div><ChevronRight /></button>;
}

function RelationshipInspector({ edge, nodes, timeline, momentId, explicit, onPatch, onReset, onClose, t }: { edge: FigureEdge; nodes: FigureNode[]; timeline: TimelineMoment[]; momentId: string; explicit: boolean; onPatch: (patch: Partial<FigureEdge>) => void; onReset: () => void; onClose: () => void; t: Translate }) {
  const resolved = resolveRelationship(edge, timeline, momentId);
  const labelEditor = relationshipLabelEditor(edge, timeline, momentId);
  const from = nodes.find(node => node.id === resolved.from), to = nodes.find(node => node.id === resolved.to);
  return <aside className="storyboard-inspector" aria-label={t('timelineRelation')}><header><div><span>{t('timelineRelation')}</span><strong>{from?.name || t('timelineUnknown')} {resolved.gerichtet ? '→' : '↔'} {to?.name || t('timelineUnknown')}</strong></div><button className="icon-button" onClick={onClose} aria-label={t('timelineCloseRelation')}><X /></button></header><div className="panel-body">
    <label className="field"><span>{t('timelineLabelFromHere')}</span><input value={labelEditor.value} placeholder={labelEditor.inherited ? t('timelineInherited', { value: labelEditor.inherited }) : t('timelineRelationPlaceholder')} disabled={!resolved.active} onChange={event => onPatch({ label: event.target.value })} /></label>
    <div className="relationship-inspector-actions"><button aria-pressed={resolved.active} onClick={() => onPatch({ active: !resolved.active })}>{resolved.active ? t('timelineAppliesHere') : t('timelineEndsHere')}</button><button aria-pressed={!!resolved.gerichtet} disabled={!resolved.active} onClick={() => onPatch({ gerichtet: !resolved.gerichtet })}>{resolved.gerichtet ? t('timelineDirected') : t('timelineUndirected')}</button><button disabled={!resolved.active || !resolved.gerichtet} onClick={() => onPatch({ from: resolved.to, to: resolved.from })}><ArrowLeftRight />{t('timelineReverse')}</button></div>
    {explicit ? <button className="secondary-action reset-inheritance" onClick={onReset}><Undo2 />{t('timelineRemoveOwn')}<small>{t('timelineInheritPrevious')}</small></button> : <p className="inherited-note">{t('timelineInheritedHelp')}</p>}
  </div></aside>;
}

function relationshipName(edge: FigureEdge, nodes: FigureNode[], timeline: TimelineMoment[], momentId: string, t: Translate) {
  const current = resolveRelationship(edge, timeline, momentId), from = nodes.find(node => node.id === current.from), to = nodes.find(node => node.id === current.to);
  return `${from?.name || t('timelineUnknown')} ${current.gerichtet ? '→' : '↔'} ${to?.name || t('timelineUnknown')} · ${current.label || t('timelineNoLabel')}`;
}

function countMomentChanges(state: FigureState, momentId: string) {
  return state.edges.filter(edge => edge.versions?.some(version => version.momentId === momentId)).length + state.nodes.filter(node => node.diedMomentId === momentId).length + (state.presence || []).filter(entry => entry.momentId === momentId).length;
}
