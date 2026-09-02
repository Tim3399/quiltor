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
import type { FigureNode, FigureState, MapScale } from "../model";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";
import type { PlaceGroundNode } from "./PlaceGround";
import type { PlaceMapFlowNode } from "./PlaceMapNode";
import {
  createGroundNode,
  createPinNodes,
  createPlaceFlowNodes,
  createPlaceMapNodes,
  groundRect,
  isExpandedMap,
} from "./placeCanvasModel";
import { createPlaceMeasurementEdges } from "./placeMeasurementGraph";
import { placementForDrop } from "./placeLevels";

export type PlaceCanvasController = {
  nodes: (PlaceFlowNode | PlaceMapFlowNode | PlaceGroundNode)[];
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
  levelId,
  measuring,
  measureSelection,
  onOpenLevel,
  mapImageUrl,
  onCollapseMap: collapseMap,
  onExpandMap: expandMap,
  onResizeMap: resizeMap,
  levelScale,
  onChange,
}: {
  state: FigureState;
  /** The places drawn on the open level, not every place in the world. */
  places: FigureNode[];
  /** Which level is open; a new place is created on it. */
  levelId: string | undefined;
  measuring: boolean;
  measureSelection: string[];
  onOpenLevel: (place: FigureNode) => void;
  /** Where a stored picture can be shown from. */
  mapImageUrl: (imageId: string) => string;
  onCollapseMap: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
  onResizeMap: (place: FigureNode, size: { width: number; height: number }) => void;
  /** What a distance on the open level means, for the map's width readout. */
  levelScale: MapScale | undefined;
  onChange: (state: FigureState) => void;
}): PlaceCanvasController {
  const { t } = useI18n();
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  const flow = useRef<ReactFlowInstance<PlaceFlowNode, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  const level = useMemo(
    () => (levelId ? state.nodes.find((node) => node.id === levelId) : undefined),
    [state.nodes, levelId],
  );
  const ground = useMemo(
    () => createGroundNode({ level, sourceUrl: mapImageUrl, gridSize: GRID_SIZE }),
    [level, mapImageUrl],
  );
  const levelGround = useMemo(() => groundRect(level), [level]);
  const latestGround = useRef(levelGround);
  latestGround.current = levelGround;

  const derivedNodes = useMemo(
    () =>
      createPlaceFlowNodes({
        nodes: state.nodes,
        places,
        measuring,
        measureSelection,
        onOpenLevel,
        onExpandMap: expandMap,
        sourceUrl: mapImageUrl,
        host: levelGround,
        zoomTier,
        viewportZoom,
        t,
      }),
    [
      state.nodes,
      places,
      levelGround,
      measuring,
      measureSelection,
      onOpenLevel,
      expandMap,
      mapImageUrl,
      zoomTier,
      viewportZoom,
      t,
    ],
  );
  const [nodes, setFlowNodes] = useState<PlaceFlowNode[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);

  // Maps are derived rather than kept in the dragging state: rebuilding them
  // from the level makes a freshly created map appear at once instead of waiting
  // for the next node change.
  const laidOutMaps = useMemo(() => places.filter(isExpandedMap), [places]);
  const latestMaps = useRef(laidOutMaps);
  latestMaps.current = laidOutMaps;
  const pins = useMemo(
    () =>
      createPinNodes({
        nodes: state.nodes,
        maps: laidOutMaps,
        measuring,
        measureSelection,
        onOpenLevel,
        onExpandMap: expandMap,
        sourceUrl: mapImageUrl,
        zoomTier,
        viewportZoom,
        t,
      }),
    [
      state.nodes,
      laidOutMaps,
      measuring,
      measureSelection,
      onOpenLevel,
      expandMap,
      mapImageUrl,
      zoomTier,
      viewportZoom,
      t,
    ],
  );

  const maps = useMemo(
    () =>
      createPlaceMapNodes({
        places,
        sourceUrl: mapImageUrl,
        onCollapse: collapseMap,
        onResize: resizeMap,
        levelScale,
        t,
      }),
    [places, mapImageUrl, collapseMap, resizeMap, levelScale, t],
  );

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

  /**
   * Where a drag came to rest decides what the place now belongs to.
   *
   * Dropped on a laid-out map, it becomes something standing on that map and is
   * remembered as a fraction of it -- which is what carries it along when the
   * map is later moved or resized. Dropped anywhere else, it goes back to being
   * a place on the level itself, positioned outright.
   */
  const commitDrag = useCallback(
    (node: {
      id: string;
      position: { x: number; y: number };
      measured?: { width?: number; height?: number };
    }) => {
      const { x, y } = node.position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const current = latestState.current;
      const dragged = current.nodes.find((item) => item.id === node.id);
      if (!dragged) return;

      const patch = placementForDrop({
        dragged,
        nodes: current.nodes,
        maps: latestMaps.current,
        levelId,
        levelGround: latestGround.current,
        position: { x, y },
        size: node.measured,
      });

      const next = {
        ...current,
        nodes: current.nodes.map((item) => (item.id === node.id ? { ...item, ...patch } : item)),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals([node.id]));
    },
    [levelId, onChange, updateNodeInternals],
  );

  return {
    nodes: [...(ground ? [ground] : []), ...maps, ...nodes, ...pins],
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
        // A new place belongs to the level it was created on, not to the world.
        ...(levelId ? { parentPlaceId: levelId } : {}),
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
        // A copy is a sibling, and it does not inherit what the original holds.
        ...(levelId ? { parentPlaceId: levelId } : { parentPlaceId: undefined }),
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
    onNodeDragStop: (node) => commitDrag(node),
  };
}
