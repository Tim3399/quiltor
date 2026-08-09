import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, MiniMap, Position, applyNodeChanges, useUpdateNodeInternals, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { Copy, MapPin, MoreHorizontal, Plus, Redo2, Ruler, Trash2, Undo2, X } from 'lucide-react';
import type { FigureNode, FigureState, TimelineMoment, Workspace } from '../../types';
import { placeChronicle, placeJourney, stopDateDiff, type PlaceMomentRow, type PlaceStay } from '../figures/presence';
import { mapDistance, formatDistance } from './placeMap';
import { useLanguage } from '../../language';
import { ConfirmDialog, DELETE_HOLD_MS } from '../../shared/ui/ConfirmDialog';
import { Menu, MenuItem, MenuSeparator } from '../../shared/ui/Menu';
import { Popover } from '../../shared/ui/Popover';
import { Inspector } from '../../shared/ui/Sidebar';
import { Sheet } from '../../shared/ui/Sheet';
import { uid } from '../../types';
import './PlacesWorkspace.css';

type PlaceCardData = { place: FigureNode; measuring: boolean };
const nodeTypes = { place: OrtNode };
const GRID_SIZE = 48;

function OrtNode({ data }: NodeProps<Node<PlaceCardData>>) {
  const { t } = useLanguage();
  const item = data.place;
  return <div className={`story-node type-ort ${data.measuring ? 'is-measuring' : ''}`}>
    <Handle id="place-anchor" type="target" position={Position.Top} isConnectable={false} className="place-center-handle" />
    <Handle id="place-anchor" type="source" position={Position.Bottom} isConnectable={false} className="place-center-handle" />
    <span className="node-kind">{t('place')}</span>
    <strong>{item.name}</strong>{item.sub && <small>{item.sub}</small>}
  </div>;
}

function placePosition(place: FigureNode) {
  return { x: place.mapX ?? place.x, y: place.mapY ?? place.y };
}

type PlacesWorkspaceProps = {
  state: FigureState; onChange: (value: FigureState) => void; targetId?: string;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
};

export function PlacesWorkspace(props: PlacesWorkspaceProps) {
  return <ReactFlowProvider><PlacesWorkspaceInner {...props} /></ReactFlowProvider>;
}

function PlacesWorkspaceInner({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false, onOpen }: PlacesWorkspaceProps) {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measurePair, setMeasurePair] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deletePlace, setDeletePlace] = useState<FigureNode | null>(null);
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 719px)').matches);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const flow = useRef<ReactFlowInstance<Node<PlaceCardData>, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  const places = useMemo(() => state.nodes.filter(node => node.type === 'ort'), [state.nodes]);
  const timeline = state.timeline || [];
  const presence = state.presence || [];
  const selected = places.find(place => place.id === selectedId) || null;

  useEffect(() => {
    if (!targetId) return;
    const item = latestState.current.nodes.find(node => node.id === targetId && node.type === 'ort');
    if (item) { setSelectedId(targetId); const position = placePosition(item); setTimeout(() => flow.current?.setCenter(position.x, position.y, { zoom: 1, duration: 350 }), 0); }
  }, [targetId]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(max-width: 719px)'), update = () => setCompact(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!measuring) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMeasuring(false); setMeasurePair([]); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [measuring]);

  const derivedNodes = useMemo<Node<PlaceCardData>[]>(() => places.map(place => ({
    id: place.id, type: 'place', position: placePosition(place),
    data: { place, measuring: measurePair.includes(place.id) },
  })), [places, measurePair]);
  const [nodes, setFlowNodes] = useState<Node<PlaceCardData>[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);

  const moveNodes = useCallback((changes: NodeChange<Node<PlaceCardData>>[]) => {
    setFlowNodes(current => applyNodeChanges(changes, current));
  }, []);
  const commitPlacePosition = useCallback((id: string, position: { x: number; y: number }) => {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const current = latestState.current;
    const next = { ...current, nodes: current.nodes.map(node => node.id === id ? { ...node, mapX: position.x, mapY: position.y } : node) };
    latestState.current = next;
    onChange(next);
    window.requestAnimationFrame(() => updateNodeInternals([id]));
  }, [onChange, updateNodeInternals]);

  const handleNodeClick = (id: string) => {
    if (measuring) {
      setMeasurePair(current => current.includes(id) ? current.filter(item => item !== id) : current.length >= 2 ? [current[1], id] : [...current, id]);
      return;
    }
    setSelectedId(id);
  };

  const measureEdges = useMemo<Edge[]>(() => {
    if (measurePair.length !== 2) return [];
    const a = nodes.find(node => node.id === measurePair[0]);
    const b = nodes.find(node => node.id === measurePair[1]);
    if (!a || !b) return [];
    const distance = mapDistance({ mapX: a.position.x, mapY: a.position.y }, { mapX: b.position.x, mapY: b.position.y });
    return [{
      id: 'distance-measure', source: a.id, target: b.id, sourceHandle: 'place-anchor', targetHandle: 'place-anchor',
      type: 'straight', label: formatDistance(distance, t, state.mapScale),
      labelBgStyle: { fill: 'var(--edge-label-bg)' }, labelStyle: { fill: 'var(--edge-label-text)' },
      className: 'distance-edge',
    }];
  }, [measurePair, nodes, state.mapScale, t]);

  const stays = useMemo(() => selected ? placeJourney(selected.id, state.nodes, presence, timeline) : [], [selected, state.nodes, presence, timeline]);
  const chronicle = useMemo(() => selected ? placeChronicle(selected.id, state.nodes, presence, timeline) : [], [selected, state.nodes, presence, timeline]);

  const patchScale = (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) => onChange({ ...state, mapScale: { unitsPer100px: 1, unitLabel: t('unitsDefault'), ...state.mapScale, ...patch } });
  const addPlace = () => {
    const center = flow.current?.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }) ?? { x: 240, y: 180 };
    const place: FigureNode = { id: uid('n'), type: 'ort', name: t('newPlaceName'), label: t('place'), sub: '', x: center.x, y: center.y, mapX: center.x, mapY: center.y, accent: 'ink', profile: { extra: [] } };
    onChange({ ...state, nodes: [...state.nodes, place] }); setSelectedId(place.id);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copy: FigureNode = { ...selected, id: uid('n'), name: t('placeCopyName', { name: selected.name }), x: selected.x + GRID_SIZE, y: selected.y + GRID_SIZE, mapX: placePosition(selected).x + GRID_SIZE, mapY: placePosition(selected).y + GRID_SIZE };
    onChange({ ...state, nodes: [...state.nodes, copy] }); setSelectedId(copy.id); setActionsOpen(false);
  };
  const removePlace = () => {
    if (!deletePlace) return;
    const nodes = state.nodes.filter(node => node.id !== deletePlace.id);
    onChange({ ...state, nodes, edges: state.edges.filter(edge => edge.from !== deletePlace.id && edge.to !== deletePlace.id), presence: presence.filter(entry => entry.placeId !== deletePlace.id) });
    setSelectedId(null); setDeletePlace(null);
  };
  const patchSelected = (patch: Partial<FigureNode>) => selected && onChange({ ...state, nodes: state.nodes.map(node => node.id === selected.id ? { ...node, ...patch } : node) });
  const inspectorContent = <><div className="panel-heading"><span>{selected ? selected.name : t('inspector')}</span>{selected && <button className="icon-button" onClick={() => setSelectedId(null)} aria-label={t('closeSelection')}><X /></button>}</div>{!selected ? <div className="empty-inspector"><MapPin /><h2>{t('selectPlace')}</h2><p>{t('selectPlaceBody')}</p></div> : <><div className="panel-body places-place-fields"><label className="field"><span>{t('name')}</span><input value={selected.name} onChange={event => patchSelected({ name: event.target.value })} /></label><label className="field"><span>{t('shortDescription')}</span><textarea value={selected.sub || ''} onChange={event => patchSelected({ sub: event.target.value })} /></label></div><PlaceInspector place={selected} nodes={state.nodes} stays={stays} chronicle={chronicle} timeline={timeline} onOpen={onOpen} /></>}</>;

  return <section className="places-workspace" aria-label={t('placesLabel')}>
    <div className="context-bar">
      <div className="context-title"><strong>{t('places')}</strong><span>{t('nPlaces').replace('{n}', String(places.length))}</span></div>
      <div className="tool-group"><button className="primary" onClick={addPlace}><Plus />{t('newPlace')}</button></div>
      <div className="tool-group"><button aria-pressed={measuring} className={measuring ? 'active' : ''} onClick={() => { setMeasuring(value => !value); setMeasurePair([]); }}><Ruler />{t('measureDistance')}</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label={t('undoPlaces')}><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label={t('redoPlaces')}><Redo2 /></button></div>
      <div className="tool-group"><button ref={actionsButton} disabled={!selected} aria-label={t('placeActions')} aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen(value => !value)}><MoreHorizontal /></button><Popover anchorRef={actionsButton} open={actionsOpen} onClose={() => setActionsOpen(false)} label={t('placeActions')}><Menu label={t('placeActions')} onClose={() => setActionsOpen(false)}><MenuItem onSelect={duplicateSelected}><Copy />{t('duplicatePlace')}</MenuItem><MenuSeparator /><MenuItem onSelect={() => { setDeletePlace(selected); setActionsOpen(false); }}><Trash2 />{t('deletePlace')}</MenuItem></Menu></Popover></div>
    </div>
    <div className="figure-layout">
      <div className={`flow-area places-flow-area ${measuring ? 'is-connecting' : ''}`}>
        {measuring && <div className="mode-banner"><Ruler />
          <span>{measurePair.length === 0 ? t('clickFirstPlace') : measurePair.length === 1 ? t('clickSecondPlace') : t('distanceLiveHint')}</span>
          <button onClick={() => { setMeasuring(false); setMeasurePair([]); }}><X /><span className="sr-only">{t('stopMeasuring')}</span></button>
        </div>}
        {measuring && measurePair.length === 2 && <div className="places-scale-legend">
          <label><span>{t('scale')}</span><input type="number" min="0.01" step="0.01" value={state.mapScale?.unitsPer100px ?? 1} onChange={event => patchScale({ unitsPer100px: Number(event.target.value) || 1 })} /><span>{t('perHundredPx')}</span></label>
          <label><span className="sr-only">{t('unitLabelField')}</span><input value={state.mapScale?.unitLabel ?? t('unitsDefault')} onChange={event => patchScale({ unitLabel: event.target.value })} /></label>
        </div>}
        <ReactFlow nodes={nodes} edges={measureEdges} nodeTypes={nodeTypes} nodesConnectable={true}
          onInit={instance => { flow.current = instance; }}
          onNodeClick={(_, node) => handleNodeClick(node.id)} onPaneClick={() => { setSelectedId(null); if (measuring) setMeasurePair([]); }}
          onNodesChange={moveNodes} onNodeDragStop={(_, node) => commitPlacePosition(node.id, node.position)}
          fitView minZoom={0.15} maxZoom={2.2} deleteKeyCode={null}>
          <Background variant={BackgroundVariant.Lines} gap={GRID_SIZE} size={0.55} color="var(--line)" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" pannable zoomable nodeColor={() => 'var(--minimap-place)'} maskColor="var(--minimap-mask)" />
        </ReactFlow>
        {!places.length && <div className="places-manager-empty"><MapPin /><h2>{t('noPlacesYet')}</h2><p>{t('noPlacesYetBody')}</p></div>}
      </div>
      {!compact && <Inspector className={`inspector places-inspector ${selected ? 'has-selection' : ''}`} aria-label={t('placesInspectorLabel')}>{inspectorContent}</Inspector>}
    </div>
    {compact && selected && <Sheet open label={t('placesInspectorLabel')} onClose={() => setSelectedId(null)}>{inspectorContent}</Sheet>}
    {deletePlace && <ConfirmDialog title={t('deletePlace')} description={t('deletePlaceDescription', { name: deletePlace.name })} confirmLabel={t('deletePlace')} holdDurationMs={DELETE_HOLD_MS} onClose={() => setDeletePlace(null)} onConfirm={removePlace} />}
  </section>;
}

function PlaceInspector({ nodes, stays, chronicle, timeline, onOpen }: {
  place: FigureNode; nodes: FigureNode[]; stays: PlaceStay[]; chronicle: PlaceMomentRow[]; timeline: TimelineMoment[];
  onOpen: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useLanguage();
  return <div className="panel-body places-inspector-body">
    <details className="places-manager-section" open>
      <summary><div><h2>{t('whoWasHere')}</h2><p>{t('whoWasHereBody')}</p></div></summary>
      <div className="places-stay-table">
        {stays.map((stay, index) => {
          const figure = nodes.find(node => node.id === stay.elementId);
          if (!figure) return null;
          return <div key={`${stay.elementId}-${index}`}>
            <button className="places-link" onClick={() => onOpen({ workspace: 'figures', id: figure.id })}>{figure.name}</button>
            <span>{stay.arrivedAt.momentId ? timeline.find(moment => moment.id === stay.arrivedAt.momentId)?.title : t('initialState')}</span>
            <span>{stay.leftAt ? (stay.died ? `† ${timeline.find(moment => moment.id === stay.leftAt?.momentId)?.title ?? ''}` : timeline.find(moment => moment.id === stay.leftAt?.momentId)?.title) : t('stillHere')}</span>
            <span className="places-stay-duration">{stay.leftAt ? stopDateDiff(stay.arrivedAt, stay.leftAt, timeline).label : ''}</span>
          </div>;
        })}
        {!stays.length && <p className="places-section-empty">{t('noOneHereYet')}</p>}
      </div>
    </details>
    <details className="places-manager-section" open>
      <summary><div><h2>{t('chronicle')}</h2><p>{t('chronicleBody')}</p></div></summary>
      <div className="places-chronicle-list">
        {chronicle.map(row => <div key={row.index}>
          <strong>{row.moment ? <button className="places-link" onClick={() => onOpen({ workspace: 'timeline', id: row.moment!.id })}>{row.moment.title}</button> : t('initialState')}</strong>
          <span>{row.occupants.length ? row.occupants.map(node => node.name).join(', ') : t('nobodyHere')}</span>
          {!!row.arrived.length && <small>{t('arrived')} {row.arrived.map(node => node.name).join(', ')}</small>}
          {!!row.left.length && <small>{t('left')} {row.left.map(node => node.name).join(', ')}</small>}
        </div>)}
        {!chronicle.length && <p className="places-section-empty">{t('noMovementYet')}</p>}
      </div>
    </details>
  </div>;
}
