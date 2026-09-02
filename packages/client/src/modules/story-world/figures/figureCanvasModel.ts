import type { Edge } from "@xyflow/react";
import {
  GRAPH_RELATIONSHIP_EDGE_TYPE,
  type GraphEdgeLabelBadge,
  graphEdgeLineStyle,
  graphRelationshipEdgePresentation,
  graphRelationshipKind,
} from "../../graph";
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
    // Only ever spelled out when it is false. A node saying it is
    // draggable overrides the surface's own interactivity switch, which
    // is why the dock's lock left everything as movable as before.
    ...(figure.pinned ? { draggable: false } : {}),
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
  selectedEdgeId: string | null = null,
  semanticLabels: { kinship: string; temporal: string } = {
    kinship: "Kinship",
    temporal: "Temporal history",
  },
): Edge[] {
  const figureNames = new Map(state.nodes.map((node) => [node.id, node.name]));
  return state.edges
    .map((edge) =>
      activeMomentId
        ? resolveRelationship(edge, timeline, activeMomentId)
        : resolveRelationshipOverview(edge, timeline),
    )
    .filter((edge) => edge.active)
    .map((edge) => {
      const handles = relationshipHandles(edge, state.nodes);
      const lineStyle = graphEdgeLineStyle(edge);
      const kinship = graphRelationshipKind(edge) === "kinship";
      const temporal = !activeMomentId && Boolean(edge.versions?.length);
      const labelBadges: GraphEdgeLabelBadge[] = [
        ...(kinship ? (["kinship"] as const) : []),
        ...(temporal ? (["temporal"] as const) : []),
      ];
      const annotations = [
        ...(kinship ? [semanticLabels.kinship] : []),
        ...(temporal ? [semanticLabels.temporal] : []),
      ];
      const presentation = graphRelationshipEdgePresentation({
        directed: edge.gerichtet === true,
        variant: lineStyle,
        temporal,
        sourceLabel: figureNames.get(edge.from) || edge.from,
        targetLabel: figureNames.get(edge.to) || edge.to,
        label: edge.label,
        color: edge.color ?? (edge.style === "gold" ? "gold" : "auto"),
        annotations,
      });
      return {
        ...presentation,
        id: edge.id,
        data: {
          kind: "relationship",
          labelBadges,
          labelTitle: [edge.label, ...annotations].filter(Boolean).join(" · "),
        },
        source: edge.from,
        target: edge.to,
        sourceHandle: handles.from,
        targetHandle: handles.to,
        label: edge.label,
        selected: edge.id === selectedEdgeId,
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
      labelBgStyle: {
        fill: "var(--edge-label-bg)",
        stroke: leg.walked ? "var(--graph-edge-color-gold)" : "var(--graph-edge-color-ink)",
      },
      labelStyle: { fill: "var(--edge-label-text)" },
      markerEnd: { type: "arrowclosed" as const },
      type: GRAPH_RELATIONSHIP_EDGE_TYPE,
      animated: leg.current,
      zIndex: 5,
      className: `journey-edge ${leg.walked ? "journey-walked" : "journey-ahead"} ${leg.current ? "journey-current" : ""}`,
      data: { kind: "journey" },
      selectable: false,
      focusable: false,
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
      data: { kind: "presence" },
      selectable: false,
      focusable: false,
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
