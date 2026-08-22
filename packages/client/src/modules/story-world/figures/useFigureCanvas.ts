import {
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
  useUpdateNodeInternals,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import type { FigureKind, FigureNode, FigureState, PresenceEntry, TimelineMoment } from "../model";
import type { FigureFlowNode } from "./FigureNode";
import {
  applyFigureNodeContext,
  combineFigureFlowEdges,
  createFigureFlowNodes,
  createJourneyFlowEdges,
  createRelationshipFlowEdges,
} from "./figureCanvasModel";
import { FIGURE_ELEMENT_TYPES } from "./figureTypes";
import { presenceByPlace } from "./presence";
import {
  alignNodesToGrid,
  connectionKind,
  GRID_SIZE,
  relationshipKey,
  type SemanticZoomTier,
  semanticZoomTier,
} from "./relationships";

export type UseFigureCanvasOptions = {
  state: FigureState;
  onChange: (state: FigureState) => void;
  selected: FigureNode | null;
  timeline: TimelineMoment[];
  presence: PresenceEntry[];
  activeMomentId: string | null;
  journeyOverlayOpen: boolean;
  relationshipsVisible: boolean;
  onSelectNode: (id: string) => void;
  onStopConnecting: () => void;
  onEnsureRelationshipsVisible: () => void;
  onConnectionError: (message: string) => void;
};

export type FigureCanvasController = {
  nodes: FigureFlowNode[];
  edges: Edge[];
  zoomTier: SemanticZoomTier;
  snapToGrid: boolean;
  gridOverride: boolean;
  setSnapToGrid: (value: boolean | ((current: boolean) => boolean)) => void;
  addNode: (kind: FigureKind) => void;
  alignAllNodes: () => void;
  centerOnNode: (node: FigureNode) => void;
  onConnect: (connection: Connection) => void;
  onInit: (instance: ReactFlowInstance<FigureFlowNode, Edge>) => void;
  onMove: (viewport: Viewport) => void;
  onNodesChange: (changes: NodeChange<FigureFlowNode>[]) => void;
  onNodeDragStop: (node: FigureFlowNode) => void;
};

export function useFigureCanvas({
  state,
  onChange,
  selected,
  timeline,
  presence,
  activeMomentId,
  journeyOverlayOpen,
  relationshipsVisible,
  onSelectNode,
  onStopConnecting,
  onEnsureRelationshipsVisible,
  onConnectionError,
}: UseFigureCanvasOptions): FigureCanvasController {
  const { t } = useI18n();
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridOverride, setGridOverride] = useState(false);
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  const flow = useRef<ReactFlowInstance<FigureFlowNode, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  useEffect(() => {
    const setOverride = (event: KeyboardEvent) => {
      if (event.key === "Alt") setGridOverride(event.type === "keydown");
    };
    const clearOverride = () => setGridOverride(false);
    window.addEventListener("keydown", setOverride);
    window.addEventListener("keyup", setOverride);
    window.addEventListener("blur", clearOverride);
    return () => {
      window.removeEventListener("keydown", setOverride);
      window.removeEventListener("keyup", setOverride);
      window.removeEventListener("blur", clearOverride);
    };
  }, []);

  const guestsByPlace = useMemo(
    () => presenceByPlace(state.nodes, presence, timeline, activeMomentId),
    [state.nodes, presence, timeline, activeMomentId],
  );
  const derivedNodes = useMemo(
    () => createFigureFlowNodes(state.nodes, zoomTier, viewportZoom),
    [state.nodes, zoomTier, viewportZoom],
  );
  const nodeContext = useRef({ timeline, activeMomentId, guestsByPlace });
  nodeContext.current = { timeline, activeMomentId, guestsByPlace };
  const [nodes, setFlowNodes] = useState<FigureFlowNode[]>(() =>
    applyFigureNodeContext(derivedNodes, timeline, activeMomentId, guestsByPlace),
  );
  useEffect(() => {
    const current = nodeContext.current;
    setFlowNodes(
      applyFigureNodeContext(
        derivedNodes,
        current.timeline,
        current.activeMomentId,
        current.guestsByPlace,
      ),
    );
  }, [derivedNodes]);
  useEffect(() => {
    setFlowNodes((current) =>
      applyFigureNodeContext(current, timeline, activeMomentId, guestsByPlace),
    );
  }, [timeline, activeMomentId, guestsByPlace]);

  const relationshipEdges = useMemo(
    () => createRelationshipFlowEdges(state, timeline, activeMomentId),
    [state, timeline, activeMomentId],
  );
  const journeyEdges = useMemo(
    () =>
      createJourneyFlowEdges({
        state,
        selected,
        timeline,
        presence,
        activeMomentId,
        journeyOverlayOpen,
      }),
    [state, selected, timeline, presence, activeMomentId, journeyOverlayOpen],
  );
  const edges = useMemo(
    () => combineFigureFlowEdges(relationshipEdges, journeyEdges, relationshipsVisible),
    [relationshipEdges, journeyEdges, relationshipsVisible],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = connection.source;
      const target = connection.target;
      if (!source || !target) return;
      const kind = connectionKind(connection.sourceHandle, connection.targetHandle);
      if (!kind) {
        onConnectionError(t("connectDirectedHelp"));
        return;
      }
      const duplicate = state.edges.find(
        (edge) =>
          relationshipKey(edge.from, edge.to, !!edge.gerichtet) ===
          relationshipKey(source, target, kind === "directed"),
      );
      if (duplicate) {
        onSelectNode(duplicate.from);
        onStopConnecting();
        onConnectionError(t("relationExists"));
        return;
      }
      const edge = {
        id: uid("e"),
        from: source,
        to: target,
        fromHandle: connection.sourceHandle || undefined,
        toHandle: connection.targetHandle || undefined,
        gerichtet: kind === "directed",
        label: "",
        style: "solid" as const,
        ...(activeMomentId
          ? {
              active: false,
              versions: [
                {
                  momentId: activeMomentId,
                  label: "",
                  style: "solid" as const,
                  gerichtet: kind === "directed",
                  active: true,
                },
              ],
            }
          : {}),
      };
      onChange({ ...state, edges: [...state.edges, edge] });
      onEnsureRelationshipsVisible();
      onConnectionError("");
    },
    [
      activeMomentId,
      onChange,
      onConnectionError,
      onEnsureRelationshipsVisible,
      onSelectNode,
      onStopConnecting,
      state,
      t,
    ],
  );

  const onNodesChange = useCallback((changes: NodeChange<FigureFlowNode>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const commitNodePosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      const current = latestState.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, x: position.x, y: position.y } : node,
        ),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals(current.nodes.map((node) => node.id)));
    },
    [onChange, updateNodeInternals],
  );
  const alignAllNodes = useCallback(() => {
    const current = latestState.current;
    const next = { ...current, nodes: alignNodesToGrid(current.nodes) };
    latestState.current = next;
    onChange(next);
    window.requestAnimationFrame(() => updateNodeInternals(next.nodes.map((node) => node.id)));
  }, [onChange, updateNodeInternals]);
  const addNode = useCallback(
    (kind: FigureKind) => {
      const center = flow.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 300, y: 250 };
      const position = snapToGrid
        ? {
            x: Math.round(center.x / GRID_SIZE) * GRID_SIZE,
            y: Math.round(center.y / GRID_SIZE) * GRID_SIZE,
          }
        : center;
      const definition =
        FIGURE_ELEMENT_TYPES.find((item) => item.kind === kind) ?? FIGURE_ELEMENT_TYPES[0];
      const node: FigureNode = {
        id: uid("n"),
        x: position.x,
        y: position.y,
        type: kind,
        label: t(definition.nodeLabel),
        name: t(definition.initialName),
        sub: "",
        accent: "ink",
        profile: { extra: [] },
      };
      onChange({ ...state, nodes: [...state.nodes, node] });
      onSelectNode(node.id);
    },
    [onChange, onSelectNode, snapToGrid, state, t],
  );
  const centerOnNode = useCallback((node: FigureNode) => {
    window.setTimeout(() => flow.current?.setCenter(node.x, node.y, { zoom: 1, duration: 350 }), 0);
  }, []);

  return {
    nodes,
    edges,
    zoomTier,
    snapToGrid,
    gridOverride,
    setSnapToGrid,
    addNode,
    alignAllNodes,
    centerOnNode,
    onConnect,
    onInit: (instance) => {
      flow.current = instance;
      const zoom = instance.getZoom();
      setViewportZoom(zoom);
      setZoomTier(semanticZoomTier(zoom));
    },
    onMove: (viewport) => {
      const zoom = Math.round(viewport.zoom * 100) / 100;
      setViewportZoom((current) => (current === zoom ? current : zoom));
      setZoomTier((current) => {
        const next = semanticZoomTier(zoom);
        return current === next ? current : next;
      });
    },
    onNodesChange,
    onNodeDragStop: (node) => commitNodePosition(node.id, node.position),
  };
}
