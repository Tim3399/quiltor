import {
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
  useUpdateNodeInternals,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import { GRID_SIZE, type SemanticZoomTier, semanticZoomTier } from "../figures/relationships";
import type { FigureNode, FigureState } from "../model";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";
import { createPlaceFlowNodes } from "./placeCanvasModel";
import { createPlaceMeasurementEdges } from "./placeMeasurementGraph";

export type PlaceCanvasController = {
  nodes: PlaceFlowNode[];
  edges: Edge[];
  zoomTier: SemanticZoomTier;
  addPlace: () => FigureNode;
  duplicatePlace: (place: FigureNode) => FigureNode;
  centerOnPlace: (place: FigureNode) => void;
  onInit: (instance: ReactFlowInstance<PlaceFlowNode, Edge>) => void;
  onMove: (viewport: Viewport) => void;
  onNodesChange: (changes: NodeChange<PlaceFlowNode>[]) => void;
  onNodeDragStop: (node: PlaceFlowNode) => void;
};

export function usePlaceCanvas({
  state,
  places,
  measuring,
  measureSelection,
  onChange,
}: {
  state: FigureState;
  places: FigureNode[];
  measuring: boolean;
  measureSelection: string[];
  onChange: (state: FigureState) => void;
}): PlaceCanvasController {
  const { t } = useI18n();
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  const flow = useRef<ReactFlowInstance<PlaceFlowNode, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  const derivedNodes = useMemo(
    () =>
      createPlaceFlowNodes({
        places,
        measuring,
        measureSelection,
        zoomTier,
        viewportZoom,
        t,
      }),
    [places, measuring, measureSelection, zoomTier, viewportZoom, t],
  );
  const [nodes, setFlowNodes] = useState<PlaceFlowNode[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);

  const edges = useMemo(
    () =>
      measuring
        ? createPlaceMeasurementEdges({
            points: nodes.map((node) => ({
              id: node.id,
              name: node.data.place.name,
              mapX: node.position.x,
              mapY: node.position.y,
            })),
            selection: measureSelection,
            scale: state.mapScale,
            t,
          })
        : [],
    [measuring, measureSelection, nodes, state.mapScale, t],
  );

  const commitPlacePosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      const current = latestState.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, mapX: position.x, mapY: position.y } : node,
        ),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals([id]));
    },
    [onChange, updateNodeInternals],
  );

  return {
    nodes,
    edges,
    zoomTier,
    addPlace: () => {
      const current = latestState.current;
      const center = flow.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 240, y: 180 };
      const place: FigureNode = {
        id: uid("n"),
        type: "ort",
        name: t("newPlace"),
        label: t("place"),
        sub: "",
        x: center.x,
        y: center.y,
        mapX: center.x,
        mapY: center.y,
        accent: "ink",
        profile: { fields: [] },
      };
      const next = { ...current, nodes: [...current.nodes, place] };
      latestState.current = next;
      onChange(next);
      return place;
    },
    duplicatePlace: (place) => {
      const current = latestState.current;
      const copy: FigureNode = {
        ...place,
        id: uid("n"),
        name: t("copyName", { name: place.name }),
        x: place.x + GRID_SIZE,
        y: place.y + GRID_SIZE,
        mapX: placePosition(place).x + GRID_SIZE,
        mapY: placePosition(place).y + GRID_SIZE,
      };
      const next = { ...current, nodes: [...current.nodes, copy] };
      latestState.current = next;
      onChange(next);
      return copy;
    },
    centerOnPlace: (place) => {
      const position = placePosition(place);
      window.setTimeout(
        () => flow.current?.setCenter(position.x, position.y, { zoom: 1, duration: 350 }),
        0,
      );
    },
    onInit: (instance) => {
      flow.current = instance;
      const zoom = instance.getZoom();
      setViewportZoom(zoom);
      setZoomTier(semanticZoomTier(zoom));
    },
    onMove: (viewport) => {
      const zoom = Math.round(viewport.zoom * 10_000) / 10_000;
      setViewportZoom((current) => (current === zoom ? current : zoom));
      setZoomTier((current) => {
        const next = semanticZoomTier(zoom);
        return current === next ? current : next;
      });
    },
    onNodesChange: (changes) => setFlowNodes((current) => applyNodeChanges(changes, current)),
    onNodeDragStop: (node) => commitPlacePosition(node.id, node.position),
  };
}
