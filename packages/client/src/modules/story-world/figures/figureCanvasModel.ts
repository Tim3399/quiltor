import type { Edge } from "@xyflow/react";
import type { FigureNode, FigureState, PresenceEntry, TimelineMoment } from "../model";
import type { FigureFlowNode } from "./FigureNode";
import {
  figureJourney,
  journeyHandles,
  journeyLegs,
  resolvePresence,
  stopDateDiff,
} from "./presence";
import {
  figureIsDeceased,
  relationshipHandles,
  resolveRelationship,
  resolveRelationshipOverview,
  type SemanticZoomTier,
} from "./relationships";

const EMPTY_NODES: FigureNode[] = [];

export function createFigureFlowNodes(
  figures: FigureNode[],
  zoomTier: SemanticZoomTier,
  viewportZoom: number,
): FigureFlowNode[] {
  return figures.map((figure) => ({
    id: figure.id,
    type: "story",
    position: { x: figure.x, y: figure.y },
    draggable: !figure.pinned,
    data: {
      figure,
      deceased: false,
      guests: EMPTY_NODES,
      zoomTier,
      zoom: viewportZoom,
    },
  }));
}

export function applyFigureNodeContext(
  nodes: FigureFlowNode[],
  timeline: TimelineMoment[],
  activeMomentId: string | null,
  guestsByPlace: ReadonlyMap<string, FigureNode[]>,
): FigureFlowNode[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      deceased: figureIsDeceased(node.data.figure, timeline, activeMomentId),
      guests: guestsByPlace.get(node.id) ?? EMPTY_NODES,
    },
  }));
}

export function createRelationshipFlowEdges(
  state: FigureState,
  timeline: TimelineMoment[],
  activeMomentId: string | null,
): Edge[] {
  return state.edges
    .map((edge) =>
      activeMomentId
        ? resolveRelationship(edge, timeline, activeMomentId)
        : resolveRelationshipOverview(edge, timeline),
    )
    .filter((edge) => edge.active)
    .map((edge) => {
      const handles = relationshipHandles(edge, state.nodes);
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: handles.from,
        targetHandle: handles.to,
        label: edge.label,
        labelBgStyle: { fill: "var(--edge-label-bg)" },
        labelStyle: { fill: "var(--edge-label-text)" },
        animated: edge.style === "blood",
        className: `edge-${edge.style || "solid"} ${edge.gerichtet ? "edge-directed" : "edge-undirected"} ${!activeMomentId && edge.versions?.length ? "edge-temporal" : ""}`,
        markerEnd: edge.gerichtet ? { type: "arrowclosed" as const } : undefined,
      };
    });
}

export function createJourneyFlowEdges({
  state,
  selected,
  timeline,
  presence,
  activeMomentId,
  journeyOverlayOpen,
}: {
  state: FigureState;
  selected: FigureNode | null;
  timeline: TimelineMoment[];
  presence: PresenceEntry[];
  activeMomentId: string | null;
  journeyOverlayOpen: boolean;
}): Edge[] {
  if (
    !journeyOverlayOpen ||
    !selected ||
    (selected.type !== "person" && selected.type !== "tier")
  ) {
    return [];
  }
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const stops = figureJourney(selected, presence, timeline);
  const legs = journeyLegs(stops, timeline, activeMomentId);
  const result: Edge[] = [];
  legs.forEach((leg, index) => {
    const fromNode = nodeById.get(leg.from.placeId);
    const toNode = nodeById.get(leg.to.placeId);
    if (!fromNode || !toNode) return;
    const handles = journeyHandles(fromNode, toNode);
    result.push({
      id: `journey:${selected.id}:${index}`,
      source: leg.from.placeId,
      target: leg.to.placeId,
      sourceHandle: handles.from,
      targetHandle: handles.to,
      label: leg.to.momentId
        ? [
            timeline.find((moment) => moment.id === leg.to.momentId)?.title,
            stopDateDiff(leg.from, leg.to, timeline, state.timeSystem).label,
          ]
            .filter(Boolean)
            .join(" · ")
        : undefined,
      labelBgStyle: { fill: "var(--edge-label-bg)" },
      labelStyle: { fill: "var(--edge-label-text)" },
      markerEnd: { type: "arrowclosed" as const },
      animated: leg.current,
      zIndex: 5,
      className: `journey-edge ${leg.walked ? "journey-walked" : "journey-ahead"} ${leg.current ? "journey-current" : ""}`,
    });
  });
  const currentPresence = resolvePresence(selected.id, presence, timeline, activeMomentId);
  const placeNode = currentPresence ? nodeById.get(currentPresence.placeId) : undefined;
  if (activeMomentId && placeNode && !figureIsDeceased(selected, timeline, activeMomentId)) {
    const handles = journeyHandles(selected, placeNode);
    result.push({
      id: `presence:${selected.id}`,
      source: selected.id,
      target: placeNode.id,
      sourceHandle: handles.from,
      targetHandle: handles.to,
      zIndex: 5,
      className: "presence-edge",
    });
  }
  return result;
}

export function combineFigureFlowEdges(
  relationshipEdges: Edge[],
  journeyEdges: Edge[],
  relationshipsVisible: boolean,
): Edge[] {
  return [...(relationshipsVisible ? relationshipEdges : []), ...journeyEdges];
}
