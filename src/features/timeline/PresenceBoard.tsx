import { useState } from 'react';
import type { FigureNode, PresenceEntry, TimelineMoment } from '../../types';
import { presenceFieldEditor } from '../figures/presence';

const UNCHANGED = '__unchanged__';

export function PresenceBoard({ nodes, places, presence, timeline, momentId, onPatch }: {
  nodes: FigureNode[]; places: FigureNode[]; presence: PresenceEntry[]; timeline: TimelineMoment[];
  momentId: string; onPatch: (nodeId: string, placeId: string) => void;
}) {
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const editorFor = (node: FigureNode) => presenceFieldEditor(node.id, presence, timeline, momentId);
  const assign = (nodeId: string, laneId: string) => onPatch(nodeId, laneId === UNCHANGED ? '' : laneId);

  const lanes = [{ id: UNCHANGED, name: 'Unverändert / kein Ort' }, ...places.map(place => ({ id: place.id, name: place.name }))];

  return <div className="presence-board">
    <div className="presence-board-roster" role="list" aria-label="Figuren und Tiere">
      {nodes.map(node => {
        const editor = editorFor(node);
        const inheritedName = !editor.placeId && editor.inheritedPlaceId ? places.find(place => place.id === editor.inheritedPlaceId)?.name : undefined;
        return <button key={node.id} role="listitem" draggable
          className={`presence-chip type-${node.type} ${selectedChip === node.id ? 'selected' : ''}`}
          aria-pressed={selectedChip === node.id}
          onDragStart={event => event.dataTransfer.setData('application/x-quiltor-figure', node.id)}
          onClick={() => setSelectedChip(current => current === node.id ? null : node.id)}>
          <strong>{node.name}</strong>{inheritedName && <small>geerbt · {inheritedName}</small>}
        </button>;
      })}
      {!nodes.length && <p className="timeline-section-empty">Noch keine Figuren oder Tiere vorhanden.</p>}
    </div>
    <div className="presence-board-lanes">
      {lanes.map(lane => {
        const occupants = nodes.filter(node => { const editor = editorFor(node); return lane.id === UNCHANGED ? !editor.placeId : editor.placeId === lane.id; });
        return <div key={lane.id} className={`presence-lane ${dropTarget === lane.id ? 'drop-active' : ''}`}
          onDragOver={event => { event.preventDefault(); setDropTarget(lane.id); }}
          onDragLeave={() => setDropTarget(current => current === lane.id ? null : current)}
          onDrop={event => {
            event.preventDefault(); setDropTarget(null);
            const nodeId = event.dataTransfer.getData('application/x-quiltor-figure');
            if (nodeId) assign(nodeId, lane.id);
          }}
          onClick={() => { if (selectedChip) { assign(selectedChip, lane.id); setSelectedChip(null); } }}>
          <header>{lane.name}</header>
          <div className="presence-lane-items">
            {occupants.map(node => <span key={node.id} className={`presence-chip-mini type-${node.type}`}>{node.name}</span>)}
            {!occupants.length && <span className="presence-lane-empty">—</span>}
          </div>
        </div>;
      })}
      {!places.length && <p className="timeline-section-empty">Noch keine Orte im Figurenboard.</p>}
    </div>
  </div>;
}
