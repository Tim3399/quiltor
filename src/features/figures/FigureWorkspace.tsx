import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, MiniMap, Position, addEdge, type Connection, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { Download, Link2, Plus, Redo2, Trash2, Undo2, Upload, UserRound, X } from 'lucide-react';
import type { FigureNode, FigureState, FigureKind, Profile } from '../../types';
import { PROFILE_FIELDS, uid } from '../../types';
import { download } from '../../lib/api';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

type CardData = { figure: FigureNode };
const nodeTypes = { story: StoryNode };
const ELEMENT_TYPES: Array<{ kind: FigureKind; label: string; initialName: string; nodeLabel: string; quick: boolean }> = [
  { kind: 'person', label: 'Figur', initialName: 'Neue Figur', nodeLabel: 'Rolle', quick: true },
  { kind: 'ort', label: 'Ort', initialName: 'Neuer Ort', nodeLabel: 'Ort', quick: true },
  { kind: 'konzept', label: 'Konzept', initialName: 'Neues Konzept', nodeLabel: 'Konzept', quick: true },
];

function StoryNode({ data, selected }: NodeProps<Node<CardData>>) {
  const item = data.figure;
  return <div className={`story-node type-${item.type || 'person'} accent-${item.accent || 'ink'} ${item.dash ? 'dashed' : ''} ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <span className="node-kind">{item.type === 'ort' ? 'Ort' : item.type === 'konzept' ? 'Konzept' : item.label || 'Figur'}</span>
    <strong>{item.name}</strong>{item.sub && <small>{item.sub}</small>}
    <Handle type="source" position={Position.Right} />
  </div>;
}

export function FigureWorkspace({ state, onChange, targetId, onUndo, onRedo, canUndo = false, canRedo = false }: { state: FigureState; onChange: (value: FigureState) => void; targetId?: string; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImport, setPendingImport] = useState<FigureState | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const flow = useRef<ReactFlowInstance<Node<CardData>, Edge> | null>(null);
  const selected = state.nodes.find(node => node.id === selectedId) ?? null;
  useEffect(() => { if (targetId && state.nodes.some(node => node.id === targetId)) { setSelectedId(targetId); const item = state.nodes.find(node => node.id === targetId); if (item) setTimeout(() => flow.current?.setCenter(item.x, item.y, { zoom: 1, duration: 350 }), 0); } }, [targetId, state.nodes]);
  const nodes = useMemo<Node<CardData>[]>(() => state.nodes.map(item => ({ id: item.id, type: 'story', position: { x: item.x, y: item.y }, data: { figure: item } })), [state.nodes]);
  const edges = useMemo<Edge[]>(() => state.edges.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label, labelBgStyle: { fill: 'var(--edge-label-bg)' }, labelStyle: { fill: 'var(--edge-label-text)' }, animated: edge.style === 'blood', className: `edge-${edge.style || 'solid'}`, markerEnd: edge.gerichtet ? { type: 'arrowclosed' as const } : undefined })), [state.edges]);

  const patchNode = (id: string, patch: Partial<FigureNode>) => onChange({ ...state, nodes: state.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
  const addNode = (kind: FigureKind) => {
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 300, y: 250 };
    const definition = ELEMENT_TYPES.find(item => item.kind === kind) ?? ELEMENT_TYPES[0];
    const node: FigureNode = { id: uid('n'), x: center.x, y: center.y, type: kind, label: definition.nodeLabel, name: definition.initialName, sub: '', accent: 'ink', profile: { extra: [] } };
    onChange({ ...state, nodes: [...state.nodes, node] }); setSelectedId(node.id); setCreateMenuOpen(false);
  };
  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const uiEdge = addEdge(connection, edges).at(-1);
    onChange({ ...state, edges: [...state.edges, { id: uiEdge?.id || uid('e'), from: connection.source, to: connection.target, label: '', style: 'solid' }] });
    setConnecting(false);
  }, [edges, onChange, state]);
  const moveNodes = useCallback((changes: NodeChange<Node<CardData>>[]) => {
    const positions = new Map(changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position] as const] : []));
    if (!positions.size) return;
    onChange({ ...state, nodes: state.nodes.map(node => {
      const position = positions.get(node.id);
      return position ? { ...node, x: position.x, y: position.y } : node;
    }) });
  }, [onChange, state]);
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
      <div className="tool-group create-group"><div className="element-create"><button className="create-action" aria-expanded={createMenuOpen} aria-haspopup="menu" onClick={() => setCreateMenuOpen(value => !value)}><Plus />Element</button>{createMenuOpen && <div className="element-create-menu" role="menu">{ELEMENT_TYPES.map(type => <button key={type.kind} role="menuitem" onClick={() => addNode(type.kind)}><Plus />{type.label}</button>)}</div>}</div>{ELEMENT_TYPES.filter(type => type.quick).map(type => <button className="create-action" key={type.kind} onClick={() => addNode(type.kind)}><Plus />{type.label}</button>)}</div>
      <div className="tool-group"><button aria-pressed={connecting} className={connecting ? 'active' : ''} onClick={() => setConnecting(!connecting)}><Link2 />Verbinden</button></div>
      <div className="tool-group"><button disabled={!canUndo} onClick={onUndo} aria-label="Diagramm rückgängig"><Undo2 /></button><button disabled={!canRedo} onClick={onRedo} aria-label="Diagramm wiederholen"><Redo2 /></button></div>
      <div className="tool-group"><button onClick={exportProfiles}><Download />Steckbriefe</button><button onClick={exportState}><Download />JSON</button><button onClick={() => input.current?.click()}><Upload />Import</button><input ref={input} hidden type="file" accept="application/json" onChange={event => void importState(event.target.files?.[0])} /></div>
    </div>
    <div className="figure-layout">
      <div className={`flow-area ${connecting ? 'is-connecting' : ''}`}>
        {connecting && <div className="mode-banner"><Link2 />Vom Ausgangspunkt zum Ziel ziehen <button onClick={() => setConnecting(false)}><X /><span className="sr-only">Abbrechen</span></button></div>}
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={instance => { flow.current = instance; }}
          onNodeClick={(_, node: Node<CardData>) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)}
          onNodesChange={moveNodes}
          onConnect={connect} nodesConnectable={connecting} fitView minZoom={0.2} maxZoom={2.2} deleteKeyCode={null}>
          <Background gap={24} size={1} color="var(--line-strong)" /><Controls position="bottom-left" /><MiniMap pannable zoomable nodeColor="var(--minimap-node)" maskColor="var(--minimap-mask)" />
        </ReactFlow>
      </div>
      <aside className={`inspector figure-inspector ${selected ? 'has-selection' : ''}`} aria-label="Figuren-Inspector">
        <div className="panel-heading"><span>{selected ? 'Auswahl' : 'Inspector'}</span>{selected && <button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Auswahl schließen"><X /></button>}</div>
        {!selected ? <div className="empty-inspector"><UserRound /><h2>Element auswählen</h2><p>Wähle eine Figur, einen Ort oder ein Konzept, um Details und Beziehungen zu bearbeiten.</p></div>
        : <FigureInspector figure={selected} state={state} onPatch={patch => patchNode(selected.id, patch)} onState={onChange} onDelete={() => setConfirmDelete(true)} />}
      </aside>
    </div>
    {importError && <div className="toast error-box" role="alert">{importError}<button onClick={() => setImportError('')}><X /><span className="sr-only">Meldung schließen</span></button></div>}
    {selected && confirmDelete && <ConfirmDialog title="Element löschen" description={`„${selected.name}“ und alle zugehörigen Verbindungen werden entfernt. Halte den Löschknopf fünf Sekunden gedrückt.`} confirmLabel="Element löschen" holdDurationMs={5000} onConfirm={remove} onClose={() => setConfirmDelete(false)} />}
    {pendingImport && <ConfirmDialog title="Diagramm importieren" description={`${pendingImport.nodes.length} Elemente und ${pendingImport.edges.length} Verbindungen ersetzen den aktuellen Stand. Vorher wird automatisch gesichert.`} confirmLabel="Importieren" onConfirm={() => { onChange(pendingImport); setSelectedId(null); setPendingImport(null); }} onClose={() => setPendingImport(null)} />}
  </section>;
}

function FigureInspector({ figure, state, onPatch, onState, onDelete }: { figure: FigureNode; state: FigureState; onPatch: (patch: Partial<FigureNode>) => void; onState: (state: FigureState) => void; onDelete: () => void }) {
  const [tab, setTab] = useState<'card' | 'profile' | 'links'>('card');
  const profile = figure.profile || { extra: [] };
  const patchProfile = (patch: Partial<Profile>) => onPatch({ profile: { ...profile, ...patch } });
  const linked = state.edges.filter(edge => edge.from === figure.id || edge.to === figure.id);
  return <>
    <div className="panel-tabs three" role="tablist"><button role="tab" aria-selected={tab === 'card'} onClick={() => setTab('card')}>Karte</button><button role="tab" aria-selected={tab === 'profile'} onClick={() => setTab('profile')}>Steckbrief</button><button role="tab" aria-selected={tab === 'links'} onClick={() => setTab('links')}>Beziehungen</button></div>
    <div className="panel-body">
      {tab === 'card' && <>
        <label className="field"><span>Art</span><select value={figure.type || 'person'} onChange={event => onPatch({ type: event.target.value as FigureKind })}><option value="person">Figur</option><option value="ort">Ort</option><option value="konzept">Konzept</option></select></label>
        <label className="field"><span>Name</span><input value={figure.name} onChange={event => onPatch({ name: event.target.value })} /></label>
        <label className="field"><span>Rolle / Kategorie</span><input value={figure.label || ''} onChange={event => onPatch({ label: event.target.value })} /></label>
        <label className="field"><span>Kurzbeschreibung</span><textarea value={figure.sub || ''} onChange={event => onPatch({ sub: event.target.value })} /></label>
        <label className="field"><span>Akzent</span><select value={figure.accent || 'ink'} onChange={event => onPatch({ accent: event.target.value as FigureNode['accent'] })}><option value="ink">Neutral</option><option value="gold">Gold</option><option value="rose">Rosa</option><option value="moss">Grün</option></select></label>
      </>}
      {tab === 'profile' && <>{PROFILE_FIELDS.map(([key, label, size]) => <label className="field" key={key as string}><span>{label}</span>{size === 'short' ? <input value={String(profile[key] || '')} onChange={event => patchProfile({ [key]: event.target.value })} /> : <textarea value={String(profile[key] || '')} onChange={event => patchProfile({ [key]: event.target.value })} />}</label>)}
        <h3 className="section-label">Eigene Felder</h3>{(profile.extra || []).map((field, index) => <div className="custom-field" key={index}><input aria-label="Feldname" placeholder="Feldname" value={field.k} onChange={event => patchProfile({ extra: (profile.extra || []).map((item, i) => i === index ? { ...item, k: event.target.value } : item) })} /><textarea aria-label={`${field.k || 'Eigenes Feld'} Inhalt`} placeholder="Inhalt" value={field.v} onChange={event => patchProfile({ extra: (profile.extra || []).map((item, i) => i === index ? { ...item, v: event.target.value } : item) })} /><button className="icon-button danger-text" aria-label="Eigenes Feld entfernen" onClick={() => patchProfile({ extra: (profile.extra || []).filter((_, i) => i !== index) })}><Trash2 /></button></div>)}
        <button className="secondary-action" onClick={() => patchProfile({ extra: [...(profile.extra || []), { k: '', v: '' }] })}><Plus />Eigenes Feld</button>
      </>}
      {tab === 'links' && <div className="relation-list">{linked.length ? linked.map(edge => {
        const otherId = edge.from === figure.id ? edge.to : edge.from; const other = state.nodes.find(node => node.id === otherId);
        const patchEdge = (patch: Partial<(typeof state.edges)[number]>) => onState({ ...state, edges: state.edges.map(item => item.id === edge.id ? { ...item, ...patch } : item) });
        return <div key={edge.id}><div><span>{edge.from === figure.id ? '→' : '←'}</span><strong>{other?.name || 'Unbekannt'}</strong></div><input aria-label={`Beziehung zu ${other?.name}`} value={edge.label || ''} placeholder="Beziehung benennen" onChange={event => patchEdge({ label: event.target.value })} /><button className="icon-button danger-text" aria-label="Verbindung löschen" onClick={() => onState({ ...state, edges: state.edges.filter(item => item.id !== edge.id) })}><Trash2 /></button><select aria-label="Linienstil" value={edge.style || 'solid'} onChange={event => patchEdge({ style: event.target.value as (typeof edge.style) })}><option value="solid">Normal</option><option value="dashed">Gestrichelt</option><option value="blood">Lebenskette</option><option value="gold">Gold</option></select><label className="check-field"><input type="checkbox" checked={!!edge.gerichtet} onChange={event => patchEdge({ gerichtet: event.target.checked })} />Gerichtet</label></div>;
      }) : <p className="muted">Noch keine Beziehungen.</p>}</div>}
      <button className="danger-text inspector-delete" onClick={onDelete}><Trash2 />{figure.type === 'ort' ? 'Ort' : figure.type === 'konzept' ? 'Konzept' : 'Figur'} löschen</button>
    </div>
  </>;
}
