import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode, Controls, Handle, MiniMap, Position, addEdge, applyNodeChanges, useUpdateNodeInternals, type Connection, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { Clock3, Download, Grid3X3, LayoutGrid, Link2, Pause, Pin, Play, Plus, Redo2, Skull, Star, Trash2, Undo2, Upload, UserRound, X } from 'lucide-react';
import type { FigureEdge, FigureNode, FigureState, FigureKind, Profile, RelationshipVersion, TimelineMoment } from '../../types';
import { PROFILE_FIELDS, uid } from '../../types';
import { download } from '../../lib/api';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

export type SemanticZoomTier = 'detail' | 'compact' | 'overview';
type CardData = { figure: FigureNode; deceased: boolean; zoomTier: SemanticZoomTier; zoom: number };
const nodeTypes = { story: StoryNode };
const EMPTY_TIMELINE: TimelineMoment[] = [];
const GRID_SIZE = 48;
const ELEMENT_TYPES: Array<{ kind: FigureKind; label: string; initialName: string; nodeLabel: string; quick: boolean }> = [
  { kind: 'person', label: 'Figur', initialName: 'Neue Figur', nodeLabel: 'Rolle', quick: true },
  { kind: 'ort', label: 'Ort', initialName: 'Neuer Ort', nodeLabel: 'Ort', quick: true },
  { kind: 'konzept', label: 'Konzept', initialName: 'Neues Konzept', nodeLabel: 'Konzept', quick: true },
  { kind: 'tier', label: 'Tier', initialName: 'Neues Tier', nodeLabel: 'Art / Rolle', quick: false },
  { kind: 'organisation', label: 'Organisation', initialName: 'Neue Organisation', nodeLabel: 'Art / Funktion', quick: false },
  { kind: 'objekt', label: 'Objekt', initialName: 'Neues Objekt', nodeLabel: 'Art / Bedeutung', quick: false },
];

function StoryNode({ data, selected }: NodeProps<Node<CardData>>) {
  const item = data.figure;
  const semanticScale = data.zoomTier === 'overview' ? 1 / Math.max(data.zoom, .08) : 1;
  return <div style={{ '--semantic-scale': semanticScale } as CSSProperties} className={`story-node zoom-${data.zoomTier} type-${item.type || 'person'} accent-${item.accent || 'ink'} ${item.important ? 'is-important' : ''} ${item.dash ? 'dashed' : ''} ${data.deceased ? 'is-deceased' : ''} ${selected ? 'selected' : ''}`}>
    <Handle id="in" className="directed-handle incoming-handle" type="target" position={Position.Left} />
    <Handle id="neutral-top" className="neutral-handle" type="source" position={Position.Top} />
    <span className="node-kind">{item.type === 'ort' ? 'Ort' : item.type === 'konzept' ? 'Konzept' : item.type === 'tier' ? 'Tier' : item.type === 'organisation' ? 'Organisation' : item.type === 'objekt' ? 'Objekt' : item.label || 'Figur'}</span>
    <strong>{item.important && <Star className="importance-mark" aria-label="Wichtig" />}{item.name}{data.deceased && <Skull aria-label="Verstorben" />}</strong>{item.sub && <small>{item.sub}</small>}
    <Handle id="out" className="directed-handle outgoing-handle" type="source" position={Position.Right} />
    <Handle id="neutral-bottom" className="neutral-handle" type="source" position={Position.Bottom} />
  </div>;
}

export function minimapColorForKind(kind?: FigureKind) {
  if (kind === 'ort') return 'var(--minimap-place)';
  if (kind === 'konzept') return 'var(--minimap-concept)';
  if (kind === 'tier') return 'var(--minimap-animal)';
  if (kind === 'organisation') return 'var(--minimap-organisation)';
  if (kind === 'objekt') return 'var(--minimap-object)';
  return 'var(--minimap-person)';
}

export function alignNodesToGrid(nodes: FigureNode[]) {
  return nodes.map(node => ({ ...node, x: Math.round(node.x / GRID_SIZE) * GRID_SIZE, y: Math.round(node.y / GRID_SIZE) * GRID_SIZE }));
}

export function semanticZoomTier(zoom: number): SemanticZoomTier {
  if (zoom < 0.34) return 'overview';
  if (zoom < 0.68) return 'compact';
  return 'detail';
}

type FigureWorkspaceProps = { state: FigureState; onChange: (value: FigureState) => void; targetId?: string; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean };

export function FigureWorkspace(props: FigureWorkspaceProps) {
  return <ReactFlowProvider><FigureWorkspaceInner {...props} /></ReactFlowProvider>;
}

function FigureWorkspaceInner({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false }: FigureWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridOverride, setGridOverride] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImport, setPendingImport] = useState<FigureState | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(() => !!state.timeline?.length);
  const [playing, setPlaying] = useState(false);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [importError, setImportError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>('detail');
  const [viewportZoom, setViewportZoom] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const createMenu = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<Node<CardData>, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;
  const selected = state.nodes.find(node => node.id === selectedId) ?? null;
  const timeline = state.timeline ?? EMPTY_TIMELINE;
  useEffect(() => {
    const setOverride = (event: KeyboardEvent) => { if (event.key === 'Alt') setGridOverride(event.type === 'keydown'); };
    const clearOverride = () => setGridOverride(false);
    window.addEventListener('keydown', setOverride);
    window.addEventListener('keyup', setOverride);
    window.addEventListener('blur', clearOverride);
    return () => { window.removeEventListener('keydown', setOverride); window.removeEventListener('keyup', setOverride); window.removeEventListener('blur', clearOverride); };
  }, []);
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = (event: PointerEvent) => { if (!createMenu.current?.contains(event.target as unknown as globalThis.Node)) setCreateMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCreateMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [createMenuOpen]);
  useEffect(() => {
    if (!targetId) return;
    const item = state.nodes.find(node => node.id === targetId);
    if (item) { setSelectedId(targetId); setTimeout(() => flow.current?.setCenter(item.x, item.y, { zoom: 1, duration: 350 }), 0); return; }
    if (timeline.some(moment => moment.id === targetId)) { setActiveMomentId(targetId); setTimelineOpen(true); }
  }, [targetId, state.nodes, timeline]);
  useEffect(() => {
    if (!playing || !timeline.length) return;
    const index = activeMomentId ? timeline.findIndex(moment => moment.id === activeMomentId) : -1;
    if (index >= timeline.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setActiveMomentId(timeline[index + 1].id), 1500);
    return () => window.clearTimeout(timer);
  }, [playing, activeMomentId, timeline]);
  const derivedNodes = useMemo<Node<CardData>[]>(() => state.nodes.map(item => ({ id: item.id, type: 'story', position: { x: item.x, y: item.y }, draggable: !item.pinned, data: { figure: item, deceased: figureIsDeceased(item, timeline, activeMomentId), zoomTier, zoom: viewportZoom } })), [state.nodes, zoomTier, viewportZoom]);
  const [nodes, setFlowNodes] = useState<Node<CardData>[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);
  useEffect(() => {
    setFlowNodes(current => current.map(node => ({ ...node, data: { ...node.data, deceased: figureIsDeceased(node.data.figure, timeline, activeMomentId) } })));
  }, [timeline, activeMomentId]);
  const visibleEdges = useMemo(() => state.edges.map(edge => activeMomentId ? resolveRelationship(edge, timeline, activeMomentId) : resolveRelationshipOverview(edge, timeline)).filter(edge => edge.active), [state.edges, timeline, activeMomentId]);
  const edges = useMemo<Edge[]>(() => visibleEdges.map(edge => { const handles = relationshipHandles(edge, state.nodes); return ({ id: edge.id, source: edge.from, target: edge.to, sourceHandle: handles.from, targetHandle: handles.to, label: edge.label, labelBgStyle: { fill: 'var(--edge-label-bg)' }, labelStyle: { fill: 'var(--edge-label-text)' }, animated: edge.style === 'blood', className: `edge-${edge.style || 'solid'} ${edge.gerichtet ? 'edge-directed' : 'edge-undirected'} ${!activeMomentId && edge.versions?.length ? 'edge-temporal' : ''}`, markerEnd: edge.gerichtet ? { type: 'arrowclosed' as const } : undefined }); }), [visibleEdges, activeMomentId, state.nodes]);

  const patchNode = (id: string, patch: Partial<FigureNode>) => onChange({ ...state, nodes: state.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
  const addNode = (kind: FigureKind) => {
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 300, y: 250 };
    const position = snapToGrid ? { x: Math.round(center.x / GRID_SIZE) * GRID_SIZE, y: Math.round(center.y / GRID_SIZE) * GRID_SIZE } : center;
    const definition = ELEMENT_TYPES.find(item => item.kind === kind) ?? ELEMENT_TYPES[0];
    const node: FigureNode = { id: uid('n'), x: position.x, y: position.y, type: kind, label: definition.nodeLabel, name: definition.initialName, sub: '', accent: 'ink', profile: { extra: [] } };
    onChange({ ...state, nodes: [...state.nodes, node] }); setSelectedId(node.id); setCreateMenuOpen(false);
  };
  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const kind = connectionKind(connection.sourceHandle, connection.targetHandle);
    if (!kind) { setConnectionError('Verbinde rechts mit links für eine gerichtete Beziehung oder Mitte mit Mitte für eine ungerichtete.'); return; }
    const duplicate = state.edges.find(edge => relationshipKey(edge.from, edge.to, !!edge.gerichtet) === relationshipKey(connection.source!, connection.target!, kind === 'directed'));
    if (duplicate) { setSelectedId(duplicate.from); setConnecting(false); setConnectionError('Diese Beziehung existiert bereits und wurde im Inspector geöffnet.'); return; }
    const uiEdge = addEdge(connection, edges).at(-1);
    const edge: FigureEdge = { id: uiEdge?.id || uid('e'), from: connection.source, to: connection.target, fromHandle: connection.sourceHandle || undefined, toHandle: connection.targetHandle || undefined, gerichtet: kind === 'directed', label: '', style: 'solid', ...(activeMomentId ? { active: false, versions: [{ momentId: activeMomentId, label: '', style: 'solid', gerichtet: kind === 'directed', active: true }] } : {}) };
    onChange({ ...state, edges: [...state.edges, edge] });
    setConnecting(false); setConnectionError('');
  }, [activeMomentId, edges, onChange, state]);
  const moveNodes = useCallback((changes: NodeChange<Node<CardData>>[]) => {
    setFlowNodes(current => applyNodeChanges(changes, current));
  }, []);
  const commitNodePosition = useCallback((id: string, position: { x: number; y: number }) => {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const current = latestState.current;
    const next = { ...current, nodes: current.nodes.map(node => node.id === id ? { ...node, x: position.x, y: position.y } : node) };
    latestState.current = next;
    onChange(next);
    window.requestAnimationFrame(() => updateNodeInternals(current.nodes.map(node => node.id)));
  }, [onChange, updateNodeInternals]);
  const alignAllNodes = useCallback(() => {
    const current = latestState.current;
    const next = { ...current, nodes: alignNodesToGrid(current.nodes) };
    latestState.current = next;
    onChange(next);
    window.requestAnimationFrame(() => updateNodeInternals(next.nodes.map(node => node.id)));
  }, [onChange, updateNodeInternals]);
  const remove = () => {
    if (!selected) return;
    onChange({ ...state, nodes: state.nodes.filter(node => node.id !== selected.id), edges: state.edges.filter(edge => edge.from !== selected.id && edge.to !== selected.id) }); setSelectedId(null);
  };
  const exportState = () => download(`quiltor-figuren-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  const exportProfiles = () => download(`Quiltor-Steckbriefe-${new Date().toISOString().slice(0, 10)}.md`, state.nodes.map(node => {
    const profile = node.profile || {}; const lines = [`# ${node.name}`, '', node.label ? `*${node.label}*` : '', node.sub || '', ''];
    PROFILE_FIELDS.forEach(([key, label]) => { const value = String(profile[key] || '').trim(); if (value) lines.push(`## ${label}`, '', value, ''); });
    (profile.extra || []).forEach(field => { if (field.k || field.v) lines.push(`## ${field.k || 'Ohne Titel'}`, '', field.v || '', ''); });
    return lines.filter((line, index) => line || lines[index - 1]).join('\n').trim();
  }).join('\n\n---\n\n'));
  const importState = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as FigureState;
      if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error();
      setPendingImport(value); setImportError('');
    } catch { setImportError('Diese Datei enthält kein gültiges Figurendiagramm.'); }
    if (input.current) input.current.value = '';
  };

  return <section className="figure-workspace" aria-label="Figuren und Beziehungen">
    <div className="context-bar">
      <div className="context-title"><strong>Figuren & Welt</strong><span>{state.nodes.length} Elemente · {state.edges.length} Verbindungen</span></div>
      <div className="tool-group create-group"><div className="element-create" ref={createMenu}><button className="create-action" aria-expanded={createMenuOpen} aria-haspopup="menu" onClick={() => setCreateMenuOpen(value => !value)}><Plus />Element</button>{createMenuOpen && <div className="element-create-menu" role="menu">{ELEMENT_TYPES.map(type => <button key={type.kind} role="menuitem" onClick={() => addNode(type.kind)}><Plus />{type.label}</button>)}</div>}</div>{ELEMENT_TYPES.filter(type => type.quick).map(type => <button className="create-action" key={type.kind} onClick={() => addNode(type.kind)}><Plus />{type.label}</button>)}</div>
      <div className="tool-group"><button aria-pressed={connecting} className={connecting ? 'active' : ''} onClick={() => setConnecting(!connecting)}><Link2 />Verbinden</button></div>
      <div className="tool-group"><button aria-pressed={snapToGrid} className={snapToGrid ? 'active' : ''} title={snapToGrid ? 'Raster ausblenden und frei verschieben · Alt/Option löst nur temporär' : 'Raster einblenden und Einrasten aktivieren'} onClick={() => setSnapToGrid(value => !value)}><Grid3X3 />Raster</button><button disabled={!state.nodes.length} title="Alle Elemente am Raster ausrichten" onClick={alignAllNodes}><LayoutGrid />Anordnen</button></div>
      <div className="tool-group"><button aria-pressed={timelineOpen} className={timelineOpen ? 'active' : ''} onClick={() => setTimelineOpen(value => !value)}><Clock3 />Zeit</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label="Diagramm rückgängig"><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label="Diagramm wiederholen"><Redo2 /></button></div>
      <div className="tool-group"><button onClick={exportProfiles}><Download />Steckbriefe</button><button onClick={exportState}><Download />JSON</button><button onClick={() => input.current?.click()}><Upload />Import</button><input ref={input} hidden type="file" accept="application/json" onChange={event => void importState(event.target.files?.[0])} /></div>
    </div>
    <div className="figure-layout">
      <div className={`flow-area zoom-${zoomTier} ${connecting ? 'is-connecting' : ''} ${playing ? 'timeline-playing' : ''}`}>
        {connecting && <div className="mode-banner"><Link2 />Rechts → links: gerichtet · Mitte ↔ Mitte: ungerichtet <button onClick={() => setConnecting(false)}><X /><span className="sr-only">Abbrechen</span></button></div>}
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose} onInit={instance => { flow.current = instance; const zoom = instance.getZoom(); setViewportZoom(zoom); setZoomTier(semanticZoomTier(zoom)); }} onMove={(_, viewport) => { const zoom = Math.round(viewport.zoom * 100) / 100; setViewportZoom(current => current === zoom ? current : zoom); setZoomTier(current => { const next = semanticZoomTier(zoom); return current === next ? current : next; }); }}
          onNodeClick={(_, node: Node<CardData>) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)}
          onNodesChange={moveNodes} onNodeDragStop={(_, node) => commitNodePosition(node.id, node.position)}
          onConnect={connect} nodesConnectable={connecting} snapToGrid={snapToGrid && !gridOverride} snapGrid={[GRID_SIZE, GRID_SIZE]} fitView minZoom={0.08} maxZoom={2.2} deleteKeyCode={null}>
          {snapToGrid && zoomTier !== 'overview' && <Background className={`board-grid board-grid-${zoomTier}`} variant={BackgroundVariant.Lines} gap={GRID_SIZE} size={0.55} color="var(--line)" />}<Controls position="bottom-left" /><MiniMap position="bottom-right" pannable zoomable nodeColor={node => minimapColorForKind((node.data as CardData).figure.type)} maskColor="var(--minimap-mask)" />
        </ReactFlow>
        {timelineOpen && <TimelineStrip timeline={timeline} activeId={activeMomentId} playing={playing} onPlay={() => { if (!timeline.length) return; if (playing) { setPlaying(false); return; } if (!activeMomentId || activeMomentId === timeline.at(-1)?.id) setActiveMomentId(timeline[0].id); setPlaying(true); }} onSelect={id => { setPlaying(false); setActiveMomentId(id); }} onAdd={(title, date) => { const moment = { id: uid('t'), title, ...(date ? { date } : {}) }; onChange({ ...state, timeline: [...timeline, moment] }); setActiveMomentId(moment.id); }} onPatch={(id, patch) => onChange({ ...state, timeline: timeline.map(moment => moment.id === id ? { ...moment, ...patch } : moment) })} onDelete={moment => setDeleteMoment(moment)} />}
      </div>
      <aside className={`inspector figure-inspector ${selected ? 'has-selection' : ''}`} aria-label="Figuren-Inspector">
        <div className="panel-heading"><span>{selected ? 'Auswahl' : 'Inspector'}</span>{selected && <button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Auswahl schließen"><X /></button>}</div>
        {!selected ? <div className="empty-inspector"><UserRound /><h2>Element auswählen</h2><p>Wähle ein Element, um Details und Beziehungen zu bearbeiten.</p></div>
        : <FigureInspector figure={selected} state={state} activeMomentId={activeMomentId} onPatch={patch => patchNode(selected.id, patch)} onState={onChange} onDelete={() => setConfirmDelete(true)} />}
      </aside>
    </div>
    {importError && <div className="toast error-box" role="alert">{importError}<button onClick={() => setImportError('')}><X /><span className="sr-only">Meldung schließen</span></button></div>}
    {connectionError && <div className="toast error-box" role="status">{connectionError}<button onClick={() => setConnectionError('')}><X /><span className="sr-only">Meldung schließen</span></button></div>}
    {selected && confirmDelete && <ConfirmDialog title="Element löschen" description={`„${selected.name}“ und alle zugehörigen Verbindungen werden entfernt. Halte den Löschknopf fünf Sekunden gedrückt.`} confirmLabel="Element löschen" holdDurationMs={5000} onConfirm={remove} onClose={() => setConfirmDelete(false)} />}
    {pendingImport && <ConfirmDialog title="Diagramm importieren" description={`${pendingImport.nodes.length} Elemente und ${pendingImport.edges.length} Verbindungen ersetzen den aktuellen Stand. Vorher wird automatisch gesichert.`} confirmLabel="Importieren" onConfirm={() => { onChange(pendingImport); setSelectedId(null); setPendingImport(null); }} onClose={() => setPendingImport(null)} />}
    {deleteMoment && <ConfirmDialog title="Zeitpunkt löschen" description={`„${deleteMoment.title}“ wird aus dem Zeitstreifen entfernt. Beziehungsänderungen an diesem Zeitpunkt fallen auf den vorherigen Stand zurück.`} confirmLabel="Zeitpunkt löschen" holdDurationMs={5000} onConfirm={() => { onChange({ ...state, timeline: timeline.filter(moment => moment.id !== deleteMoment.id), edges: state.edges.map(edge => ({ ...edge, versions: edge.versions?.filter(version => version.momentId !== deleteMoment.id) })) }); if (activeMomentId === deleteMoment.id) setActiveMomentId(null); }} onClose={() => setDeleteMoment(null)} />}
  </section>;
}

function FigureInspector({ figure, state, activeMomentId, onPatch, onState, onDelete }: { figure: FigureNode; state: FigureState; activeMomentId: string | null; onPatch: (patch: Partial<FigureNode>) => void; onState: (state: FigureState) => void; onDelete: () => void }) {
  const [tab, setTab] = useState<'card' | 'profile' | 'links'>('card');
  const profile = figure.profile || { extra: [] };
  const patchProfile = (patch: Partial<Profile>) => onPatch({ profile: { ...profile, ...patch } });
  const linked = state.edges.filter(edge => edge.from === figure.id || edge.to === figure.id);
  return <>
    <div className="panel-tabs three" role="tablist"><button role="tab" aria-selected={tab === 'card'} onClick={() => setTab('card')}>Karte</button><button role="tab" aria-selected={tab === 'profile'} onClick={() => setTab('profile')}>Steckbrief</button><button role="tab" aria-selected={tab === 'links'} onClick={() => setTab('links')}>Beziehungen</button></div>
    <div className="panel-body">
      {tab === 'card' && <>
        <label className="field"><span>Art</span><select value={figure.type || 'person'} onChange={event => onPatch({ type: event.target.value as FigureKind })}><option value="person">Figur</option><option value="tier">Tier</option><option value="ort">Ort</option><option value="organisation">Organisation</option><option value="objekt">Objekt</option><option value="konzept">Konzept</option></select></label>
        <label className="field"><span>Name</span><input value={figure.name} onChange={event => onPatch({ name: event.target.value })} /></label>
        <label className="field"><span>Rolle / Kategorie</span><input value={figure.label || ''} onChange={event => onPatch({ label: event.target.value })} /></label>
        <label className="field"><span>Kurzbeschreibung</span><textarea value={figure.sub || ''} onChange={event => onPatch({ sub: event.target.value })} /></label>
        <label className="field"><span>Akzent</span><select value={figure.accent || 'ink'} onChange={event => onPatch({ accent: event.target.value as FigureNode['accent'] })}><option value="ink">Neutral</option><option value="gold">Gold</option><option value="rose">Rosa</option><option value="moss">Grün</option></select></label>
        <div className="node-priority-actions">
          <button className={figure.important ? 'active' : ''} aria-pressed={!!figure.important} onClick={() => onPatch({ important: !figure.important })}><Star />{figure.important ? 'Nicht mehr wichtig' : 'Als wichtig markieren'}</button>
          <button className={figure.pinned ? 'active' : ''} aria-pressed={!!figure.pinned} onClick={() => onPatch({ pinned: !figure.pinned })}><Pin />{figure.pinned ? 'Position lösen' : 'Position fixieren'}</button>
        </div>
        {activeMomentId && figure.type !== 'ort' && figure.type !== 'konzept' && <button className={`timeline-life-action ${figure.diedMomentId === activeMomentId ? 'active' : ''}`} onClick={() => onPatch({ diedMomentId: figure.diedMomentId === activeMomentId ? undefined : activeMomentId })}><Skull />{figure.diedMomentId === activeMomentId ? 'Todesmarkierung entfernen' : 'Stirbt hier'}</button>}
      </>}
      {tab === 'profile' && <>{PROFILE_FIELDS.map(([key, label, size]) => <label className="field" key={key as string}><span>{label}</span>{size === 'short' ? <input value={String(profile[key] || '')} onChange={event => patchProfile({ [key]: event.target.value })} /> : <textarea value={String(profile[key] || '')} onChange={event => patchProfile({ [key]: event.target.value })} />}</label>)}
        <h3 className="section-label">Eigene Felder</h3>{(profile.extra || []).map((field, index) => <div className="custom-field" key={index}><input aria-label="Feldname" placeholder="Feldname" value={field.k} onChange={event => patchProfile({ extra: (profile.extra || []).map((item, i) => i === index ? { ...item, k: event.target.value } : item) })} /><textarea aria-label={`${field.k || 'Eigenes Feld'} Inhalt`} placeholder="Inhalt" value={field.v} onChange={event => patchProfile({ extra: (profile.extra || []).map((item, i) => i === index ? { ...item, v: event.target.value } : item) })} /><button className="icon-button danger-text" aria-label="Eigenes Feld entfernen" onClick={() => patchProfile({ extra: (profile.extra || []).filter((_, i) => i !== index) })}><Trash2 /></button></div>)}
        <button className="secondary-action" onClick={() => patchProfile({ extra: [...(profile.extra || []), { k: '', v: '' }] })}><Plus />Eigenes Feld</button>
      </>}
      {tab === 'links' && <div className="relation-list">{linked.length ? linked.map(edge => {
        const resolved = resolveRelationship(edge, state.timeline || [], activeMomentId);
        const labelEditor = relationshipLabelEditor(edge, state.timeline || [], activeMomentId);
        const otherId = resolved.from === figure.id ? resolved.to : resolved.from; const other = state.nodes.find(node => node.id === otherId);
        const patchEdge = (patch: Partial<FigureEdge>) => onState({ ...state, edges: state.edges.map(item => item.id === edge.id ? patchRelationship(item, state.timeline || [], activeMomentId, patch) : item) });
        const directionLabel = `Richtung umkehren: ${state.nodes.find(node => node.id === resolved.from)?.name || 'Unbekannt'} nach ${state.nodes.find(node => node.id === resolved.to)?.name || 'Unbekannt'}`;
        return <div key={edge.id} className={!resolved.active ? 'outside-moment' : ''}><div>{resolved.gerichtet ? <button type="button" className="relation-direction" aria-label={directionLabel} title={directionLabel} disabled={!resolved.active} onClick={() => patchEdge({ from: resolved.to, to: resolved.from })}>{resolved.from === figure.id ? '→' : '←'}</button> : <span className="relation-undirected" aria-label="Ungerichtete Beziehung" title="Ungerichtete Beziehung">↔</span>}<strong>{other?.name || 'Unbekannt'}</strong>{activeMomentId && <small>{resolved.active ? 'Gilt hier' : 'Hier nicht aktiv'}</small>}</div><label className="relationship-label-editor"><span className="sr-only">Beziehung zu {other?.name}</span><input aria-label={`Beziehung zu ${other?.name}`} value={labelEditor.value} placeholder={labelEditor.inherited || 'Beziehung benennen'} disabled={!resolved.active} onChange={event => patchEdge({ label: event.target.value })} /></label><button className="icon-button danger-text" aria-label="Verbindung löschen" onClick={() => onState({ ...state, edges: state.edges.filter(item => item.id !== edge.id) })}><Trash2 /></button><select aria-label="Linienstil" value={resolved.style || 'solid'} disabled={!resolved.active} onChange={event => patchEdge({ style: event.target.value as (typeof edge.style) })}><option value="solid">Normal</option><option value="dashed">Gestrichelt</option><option value="blood">Lebenskette</option><option value="gold">Gold</option></select><label className="check-field"><input type="checkbox" checked={!!resolved.gerichtet} disabled={!resolved.active} onChange={event => patchEdge({ gerichtet: event.target.checked })} />Gerichtet</label>{activeMomentId && <button className="relation-toggle" onClick={() => patchEdge({ active: !resolved.active })}>{resolved.active ? 'Beziehung endet hier' : 'Ab hier beginnen'}</button>}</div>;
      }) : <p className="muted">Noch keine Beziehungen.</p>}</div>}
      <button className="danger-text inspector-delete" onClick={onDelete}><Trash2 />{figure.type === 'ort' ? 'Ort' : figure.type === 'konzept' ? 'Konzept' : figure.type === 'tier' ? 'Tier' : figure.type === 'organisation' ? 'Organisation' : figure.type === 'objekt' ? 'Objekt' : 'Figur'} löschen</button>
    </div>
  </>;
}

function TimelineStrip({ timeline, activeId, playing, onPlay, onSelect, onAdd, onPatch, onDelete }: { timeline: TimelineMoment[]; activeId: string | null; playing: boolean; onPlay: () => void; onSelect: (id: string | null) => void; onAdd: (title: string, date?: string) => void; onPatch: (id: string, patch: Partial<TimelineMoment>) => void; onDelete: (moment: TimelineMoment) => void }) {
  const [draft, setDraft] = useState(''), [draftDate, setDraftDate] = useState('');
  const add = () => { const title = draft.trim(); if (!title) return; onAdd(title, draftDate || undefined); setDraft(''); setDraftDate(''); };
  const active = timeline.find(moment => moment.id === activeId);
  return <div className={`timeline-strip ${playing ? 'is-playing' : ''}`} aria-label="Beziehungs-Zeitstreifen"><div className="timeline-heading"><Clock3 /><span>Zeit</span><button className="timeline-play" disabled={!timeline.length} aria-label={playing ? 'Zeitreise pausieren' : 'Zeitreise abspielen'} onClick={onPlay}>{playing ? <Pause /> : <Play />}</button><button className={!activeId ? 'active' : ''} aria-pressed={!activeId} onClick={() => onSelect(null)}>Gesamtsicht</button></div><div className="timeline-track">{timeline.map((moment, index) => <div className="timeline-moment" key={moment.id}><span aria-hidden="true">{index + 1}</span><button className={activeId === moment.id ? 'active' : ''} aria-pressed={activeId === moment.id} onClick={() => onSelect(moment.id)}><b>{moment.title}</b>{moment.date && <small>{formatMomentDate(moment.date)}</small>}</button></div>)}</div><div className="timeline-add"><input aria-label="Neuer Zeitpunkt" value={draft} placeholder="Neuer Zeitpunkt" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><input className="timeline-date" type="date" aria-label="Datum des neuen Zeitpunkts" value={draftDate} onChange={event => setDraftDate(event.target.value)} /><button className="icon-button" disabled={!draft.trim()} aria-label="Zeitpunkt hinzufügen" onClick={add}><Plus /></button></div>{active && <div className="timeline-details"><label><span>Name</span><input value={active.title} onChange={event => onPatch(active.id, { title: event.target.value })} /></label><label><span>Datum · optional</span><input type="date" value={active.date || ''} onChange={event => onPatch(active.id, { date: event.target.value || undefined })} /></label><label><span>Notiz · optional</span><input value={active.note || ''} placeholder="Kapitel, Zeitsprung, Ereignis …" onChange={event => onPatch(active.id, { note: event.target.value })} /></label><button className="icon-button danger-text" aria-label="Zeitpunkt löschen" onClick={() => onDelete(active)}><Trash2 /></button></div>}</div>;
}

function formatMomentDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function resolveRelationship(edge: FigureEdge, timeline: TimelineMoment[], activeId: string | null): FigureEdge & { active: boolean } {
  const base = { ...edge, active: edge.active !== false };
  if (!activeId) return base;
  const activeIndex = timeline.findIndex(moment => moment.id === activeId);
  const versions = (edge.versions || []).filter(item => {
    const index = timeline.findIndex(moment => moment.id === item.momentId);
    return index >= 0 && index <= activeIndex;
  }).sort((a, b) => timeline.findIndex(moment => moment.id === a.momentId) - timeline.findIndex(moment => moment.id === b.momentId));
  return versions.reduce<FigureEdge & { active: boolean }>((current, version) => ({ ...current, ...version, id: edge.id, active: version.active }), base);
}

export function resolveRelationshipOverview(edge: FigureEdge, timeline: TimelineMoment[]): FigureEdge & { active: boolean } {
  const ordered = [...(edge.versions || [])].sort((a, b) => timeline.findIndex(moment => moment.id === a.momentId) - timeline.findIndex(moment => moment.id === b.momentId));
  const labels = [edge.label, ...ordered.filter(version => version.active).map(version => version.label)].filter((label): label is string => !!label?.trim());
  const distinctLabels = labels.filter((label, index) => labels.indexOf(label) === index);
  const latestActive = [...ordered].reverse().find(version => version.active);
  return { ...edge, ...(latestActive || {}), id: edge.id, from: edge.from, to: edge.to, label: distinctLabels.join(' → '), active: edge.active !== false || ordered.some(version => version.active) };
}

export function patchRelationship(edge: FigureEdge, timeline: TimelineMoment[], activeId: string | null, patch: Partial<FigureEdge>): FigureEdge {
  if (!activeId) return { ...edge, ...patch };
  const current = resolveRelationship(edge, timeline, activeId);
  const version: RelationshipVersion = { momentId: activeId, from: current.from, to: current.to, label: current.label, style: current.style, gerichtet: current.gerichtet, active: patch.active ?? current.active };
  if (patch.from !== undefined) version.from = patch.from;
  if (patch.to !== undefined) version.to = patch.to;
  if (patch.label !== undefined) {
    if (patch.label.trim()) version.label = patch.label;
    else delete version.label;
  }
  if (patch.style !== undefined) version.style = patch.style;
  if (patch.gerichtet !== undefined) version.gerichtet = patch.gerichtet;
  return { ...edge, versions: [...(edge.versions || []).filter(item => item.momentId !== activeId), version] };
}

export function relationshipLabelEditor(edge: FigureEdge, timeline: TimelineMoment[], activeId: string | null) {
  if (!activeId) return { value: edge.label || '', inherited: '' };
  const version = edge.versions?.find(item => item.momentId === activeId);
  const index = timeline.findIndex(moment => moment.id === activeId);
  const inherited = index > 0 ? resolveRelationship(edge, timeline, timeline[index - 1].id).label || '' : edge.label || '';
  return { value: version?.label || '', inherited: version?.label ? '' : inherited };
}

export function figureIsDeceased(figure: FigureNode, timeline: TimelineMoment[], activeId: string | null) {
  if (!figure.diedMomentId || !activeId) return false;
  const death = timeline.findIndex(moment => moment.id === figure.diedMomentId);
  const active = timeline.findIndex(moment => moment.id === activeId);
  return death >= 0 && active >= death;
}

export function connectionKind(sourceHandle?: string | null, targetHandle?: string | null): 'directed' | 'undirected' | null {
  if (sourceHandle === 'out' && targetHandle === 'in') return 'directed';
  if (sourceHandle?.startsWith('neutral-') && targetHandle?.startsWith('neutral-')) return 'undirected';
  return null;
}

export function relationshipKey(from: string, to: string, directed: boolean) {
  return directed ? `directed:${from}:${to}` : `undirected:${[from, to].sort().join(':')}`;
}

export function relationshipHandles(edge: FigureEdge, nodes: FigureNode[]) {
  if (edge.gerichtet) return { from: 'out', to: 'in' };
  const from = nodes.find(node => node.id === edge.from), to = nodes.find(node => node.id === edge.to);
  if (!from || !to) return { from: 'neutral-bottom', to: 'neutral-top' };
  const verticalDistance = to.y - from.y;
  if (Math.abs(verticalDistance) >= GRID_SIZE) return verticalDistance > 0
    ? { from: 'neutral-bottom', to: 'neutral-top' }
    : { from: 'neutral-top', to: 'neutral-bottom' };
  const graphCenterY = nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(nodes.length, 1);
  const pairCenterY = (from.y + to.y) / 2;
  const handle = pairCenterY <= graphCenterY ? 'neutral-top' : 'neutral-bottom';
  return { from: handle, to: handle };
}
