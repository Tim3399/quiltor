import {
  applyNodeChanges,
  type CoordinateExtent,
  type Edge,
  type FitViewOptions,
  getViewportForBounds,
  type NodeChange,
  type ReactFlowInstance,
  useUpdateNodeInternals,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import { type MeasuredSizes, NO_MEASURED_SIZES, rememberMeasured, withMeasured } from "../../graph";
import { GRID_SIZE, type SemanticZoomTier, semanticZoomTier } from "../figures/relationships";
import type { FigureNode, FigureState, MapScale } from "../model";
import type { PlaceGroundNode } from "./PlaceGround";
import type { PlaceMapFlowNode } from "./PlaceMapNode";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";
import {
  createGroundNode,
  createMeasurementPoints,
  createPinNodes,
  createPlaceFlowNodes,
  createPlaceMapNodes,
  groundRect,
  isExpandedMap,
  isPlaceDisplayPin,
} from "./placeCanvasModel";
import { type DragClientPoint, dragClientPoint, placeDropFrame } from "./placeDragModel";
import type { ImageCrop } from "./placeImageCrop";
import { placementForDrop, scaleForPair } from "./placeLevels";
import { createPlaceMeasurementEdges } from "./placeMeasurementGraph";

export type PlaceCanvasController = {
  nodes: (PlaceFlowNode | PlaceMapFlowNode | PlaceGroundNode)[];
  edges: Edge[];
  zoomTier: SemanticZoomTier;
  dragPreview: { id: string; name: string; clientX: number; clientY: number } | null;
  /**
   * Add a place, complete.
   *
   * `overrides` exists so a caller never has to create and then patch: the two
   * writes read different copies of the state, and the second lands on one that
   * does not know about the first -- which silently drops the place that was
   * just made.
   */
  addPlace: (overrides?: Partial<FigureNode>) => FigureNode;
  duplicatePlace: (place: FigureNode) => FigureNode;
  centerOnPlace: (place: FigureNode) => void;
  /** What the level should be framed on, which is never the paper itself. */
  fitViewOptions: FitViewOptions;
  onInit: (instance: ReactFlowInstance<PlaceFlowNode, Edge>) => void;
  onMove: (viewport: Viewport) => void;
  /** Whether the ruling is drawn, and whether things come to rest on it. */
  snapToGrid: boolean;
  setSnapToGrid: (snap: boolean) => void;
  /** Whether the map pictures are drawn, or only the ground they rule. */
  picturesVisible: boolean;
  setPicturesVisible: (visible: boolean) => void;
  /** Whether the view is held to the picture the open level stands on. */
  boundToGround: boolean;
  setBoundToGround: (bound: boolean) => void;
  /** Whether this level has a picture to be held to at all. */
  hasGround: boolean;
  /** How far the view may travel, when it is being held. */
  translateExtent: CoordinateExtent | undefined;
  /** How far out it may go, so the sheet always fills the surface. */
  minZoom: number | undefined;
  /** Told how large the surface is, since the floor is measured from it. */
  onSurfaceResize: (size: { width: number; height: number }) => void;
  onNodesChange: (changes: NodeChange<PlaceFlowNode>[]) => void;
  onNodeDragStart: (event: MouseEvent | TouchEvent, node: PlaceFlowNode) => void;
  onNodeDrag: (event: MouseEvent | TouchEvent, node: PlaceFlowNode) => void;
  onNodeDragStop: (event: MouseEvent | TouchEvent, node: PlaceFlowNode) => void;
};

export function usePlaceCanvas({
  state,
  places,
  levelId,
  measuring,
  measureSelection,
  onOpenLevel,
  mapImageUrl,
  onExpandMap: expandMap,
  onPlaceDisplayChange,
  onResizeMap: resizeMap,
  onCropMap: cropMap,
  adjustingId,
  levelScale,
  expandRequest,
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
  onExpandMap: (place: FigureNode) => void;
  onPlaceDisplayChange: (place: FigureNode, display: "card" | "pin") => void;
  onResizeMap: (place: FigureNode, size: { width: number; height: number }) => void;
  onCropMap: (place: FigureNode, crop: ImageCrop) => void;
  /** Which map's picture is being adjusted, if any. */
  adjustingId: string | undefined;
  /** What a distance on the open level means, for the map's width readout. */
  levelScale: MapScale | undefined;
  /** Only an explicit expand gesture requests camera motion. Persisted maps do not. */
  expandRequest?: { id: string; sequence: number };
  onChange: (state: FigureState) => void;
}): PlaceCanvasController {
  const { t } = useI18n();
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  // What a handle is being dragged to right now, so the map follows the
  // gesture instead of jumping to its new size when the handle is let go.
  const [liveSize, setLiveSize] = useState<{ id: string; width: number; height: number } | null>(
    null,
  );
  // The crop being dragged, held here until the gesture ends so a run of tiny
  // movements is one edit rather than a hundred.
  const [cropDraft, setCropDraft] = useState<{ id: string; crop: ImageCrop } | null>(null);
  const [livePosition, setLivePosition] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    name: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const dragSession = useRef<{ id: string; cancelled: boolean } | null>(null);
  // What the surface shows, as opposed to what it holds. Neither is written to
  // the world: how somebody is looking at a level is not part of the level.
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [picturesVisible, setPicturesVisible] = useState(true);
  const [boundToGround, setBoundToGround] = useState(true);
  const flow = useRef<ReactFlowInstance<PlaceFlowNode, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  const level = useMemo(
    () => (levelId ? state.nodes.find((node) => node.id === levelId) : undefined),
    [state.nodes, levelId],
  );
  const ground = useMemo(
    () =>
      createGroundNode({
        level,
        sourceUrl: mapImageUrl,
        gridSize: GRID_SIZE,
        gridVisible: snapToGrid,
        zoom: viewportZoom,
        picturesVisible,
      }),
    [level, mapImageUrl, snapToGrid, picturesVisible, viewportZoom],
  );
  const levelGround = useMemo(() => groundRect(level), [level]);
  /**
   * How far the view may travel while standing inside a map.
   *
   * A map is the ground of the level it opens onto, so the sheet is the world
   * down here and there is nothing beyond its edges to go and look at. The
   * extent is the sheet exactly -- no slack, because slack is somewhere past
   * the edge to end up, and not ending up there is the whole of what this is
   * for. Nothing needs reaching out there either: the ground is not something
   * that gets dragged or resized, it is what everything else stands on.
   *
   * Only where there is a picture. A level without one is the open grid it has
   * always been, and holding a view to nothing would just be a smaller canvas.
   */
  /**
   * The furthest out the view may go while it is held to the ground.
   *
   * Exactly the scale at which the sheet fills the surface it is drawn on, so
   * zooming out stops where the sheet stops. Measured from the surface rather
   * than assumed, and re-measured when it changes size, because the answer is
   * different on a phone and on a wide window.
   */
  const [surface, setSurface] = useState<{ width: number; height: number } | null>(null);
  const minZoom = useMemo(() => {
    if (!boundToGround || !levelGround || !surface) return undefined;
    if (!(levelGround.width > 0) || !(levelGround.height > 0)) return undefined;
    const fills = Math.max(surface.width / levelGround.width, surface.height / levelGround.height);
    return Number.isFinite(fills) && fills > 0 ? fills : undefined;
  }, [boundToGround, levelGround, surface]);

  const translateExtent = useMemo<CoordinateExtent | undefined>(() => {
    if (!boundToGround || !levelGround) return undefined;
    return [
      [levelGround.x, levelGround.y],
      [levelGround.x + levelGround.width, levelGround.y + levelGround.height],
    ];
  }, [boundToGround, levelGround]);
  const latestGround = useRef(levelGround);
  latestGround.current = levelGround;

  // Arriving on a level should show what is on it, at the size it deserves:
  // without this you land at whatever zoom the level above happened to be at,
  // and a map entered from a distant view opens as a postage stamp.
  //
  // Armed on the change and spent once the new level's nodes have actually been
  // handed to the flow -- fitting before that would frame the level you just
  // left, which is what a plain timeout ends up doing.
  const pendingFit = useRef(false);
  const previousLevel = useRef(levelId);
  if (previousLevel.current !== levelId) {
    previousLevel.current = levelId;
    pendingFit.current = true;
  }

  const derivedNodes = useMemo(
    () =>
      createPlaceFlowNodes({
        nodes: state.nodes,
        places,
        measuring,
        measureSelection,
        onOpenLevel,
        onExpandMap: expandMap,
        onPlaceDisplayChange,
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
      onPlaceDisplayChange,
      mapImageUrl,
      zoomTier,
      viewportZoom,
      t,
    ],
  );
  const [nodes, setFlowNodes] = useState<PlaceFlowNode[]>(derivedNodes);
  const latestDerivedNodes = useRef(derivedNodes);
  latestDerivedNodes.current = derivedNodes;
  // Read inside a change handler, where the render's own `nodes` would be the
  // list from before the gesture started.
  const latestFlowNodes = useRef(nodes);
  latestFlowNodes.current = nodes;
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);
  useEffect(() => {
    void levelId;
    if (dragSession.current) dragSession.current.cancelled = true;
    setDragPreview(null);
    setLivePosition(null);
  }, [levelId]);
  const dragPreviewId = dragPreview?.id;
  useEffect(() => {
    if (dragPreviewId && !state.nodes.some((node) => node.id === dragPreviewId)) {
      if (dragSession.current) dragSession.current.cancelled = true;
      setDragPreview(null);
      setLivePosition(null);
      setFlowNodes(latestDerivedNodes.current);
    }
  }, [dragPreviewId, state.nodes]);
  useEffect(() => {
    if (!dragPreviewId) return;
    const cancel = () => {
      if (dragSession.current) dragSession.current.cancelled = true;
      setDragPreview(null);
      setLivePosition(null);
      setFlowNodes(latestDerivedNodes.current);
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchcancel", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchcancel", cancel);
    };
  }, [dragPreviewId]);
  // Maps and the places on them are derived from the level and are not in this list.
  // Their measurement would otherwise have nowhere to go.
  const [measured, setMeasured] = useState<MeasuredSizes>(NO_MEASURED_SIZES);
  const displayModes = useRef(
    new Map(state.nodes.map((place) => [place.id, isPlaceDisplayPin(place)])),
  );
  useLayoutEffect(() => {
    const next = new Map(state.nodes.map((place) => [place.id, isPlaceDisplayPin(place)]));
    const changed = new Set<string>();
    for (const [id, pin] of next) {
      if (displayModes.current.has(id) && displayModes.current.get(id) !== pin) changed.add(id);
    }
    displayModes.current = next;
    if (changed.size === 0) return;
    setMeasured((known) => {
      const clean = new Map(known);
      for (const id of changed) clean.delete(id);
      return clean;
    });
    setFlowNodes(
      derivedNodes.map((node) => (changed.has(node.id) ? { ...node, measured: undefined } : node)),
    );
    const frame = window.requestAnimationFrame(() => updateNodeInternals([...changed]));
    return () => window.cancelAnimationFrame(frame);
  }, [derivedNodes, state.nodes, updateNodeInternals]);
  // Keyed on what the flow actually renders rather than on what was derived for
  // it: the derived list changes a commit earlier, and fitting then would frame
  // the level just left. The short wait on top gives React Flow time to measure
  // the new nodes, without which the fit has nothing to fit to.
  //
  // A timer rather than an animation frame, and no animation on the fit itself:
  // both hang on frames a backgrounded tab never runs, and arriving somewhere
  // should have framed it by the time it is looked at rather than travelling
  // there once it is.
  //
  // The flag is spent when the fit runs, not when it is scheduled: strict mode
  // runs an effect, cleans it up and runs it again, and spending it up front
  // left the first attempt cancelled and the second with nothing to do.
  useEffect(() => {
    if (!pendingFit.current || nodes.length === 0) return;
    const settle = window.setTimeout(() => {
      pendingFit.current = false;
      flow.current?.fitView(latestFitOptions.current);
    }, 60);
    return () => window.clearTimeout(settle);
  }, [nodes]);

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
        onPlaceDisplayChange,
        sourceUrl: mapImageUrl,
        livePosition,
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
      onPlaceDisplayChange,
      mapImageUrl,
      livePosition,
      zoomTier,
      viewportZoom,
      t,
    ],
  );

  const maps = useMemo(
    () =>
      createPlaceMapNodes({
        places,
        picturesVisible,
        sourceUrl: mapImageUrl,
        onResize: (place, size) => {
          setLiveSize(null);
          resizeMap(place, size);
        },
        onResizeLive: (place, size) => setLiveSize({ id: place.id, ...size }),
        onCropDraft: (place, crop) => setCropDraft({ id: place.id, crop }),
        onCropCommit: (place, crop) => {
          // The draft goes as the write lands, in the same batch, or the buttons
          // beside the canvas would be arguing with a draft nobody is dragging.
          setCropDraft(null);
          cropMap(place, crop);
        },
        cropOverride: cropDraft,
        adjustingId,
        liveSize,
        livePosition,
        gridSize: GRID_SIZE,
        gridVisible: snapToGrid,
        zoom: viewportZoom,
      }),
    [
      places,
      mapImageUrl,
      resizeMap,
      cropMap,
      cropDraft,
      adjustingId,
      picturesVisible,
      snapToGrid,
      liveSize,
      livePosition,
      viewportZoom,
    ],
  );

  const framedExpansion = useRef<typeof expandRequest>(undefined);
  useEffect(() => {
    if (!expandRequest || framedExpansion.current === expandRequest || !surface) return;
    const map = maps.find((node) => node.id === expandRequest.id);
    if (!map || !map.width || !map.height || !flow.current) return;
    // Wait until the map and the inspector's new canvas width have landed. The
    // map already has its real size; only the camera travels to reveal it.
    const settle = window.setTimeout(() => {
      framedExpansion.current = expandRequest;
      const reduced =
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--motion-medium")
        .trim();
      const milliseconds = Number.parseFloat(token) * (token.endsWith("ms") ? 1 : 1000);
      const duration = reduced ? 0 : Number.isFinite(milliseconds) ? milliseconds : 300;
      // fitBounds uses the canvas-wide maxZoom and has no per-call cap. The
      // public projection helper lets this one reveal stop at natural size.
      const viewport = getViewportForBounds(
        { ...map.position, width: map.width!, height: map.height! },
        surface.width,
        surface.height,
        minZoom ?? 0.08,
        Math.max(minZoom ?? 0, 1),
        0.18,
      );
      void flow.current?.setViewport(viewport, { duration });
    }, 60);
    return () => window.clearTimeout(settle);
  }, [expandRequest, maps, minZoom, surface]);

  const measurablePoints = useMemo(
    () => createMeasurementPoints([...nodes, ...pins], laidOutMaps),
    [nodes, pins, laidOutMaps],
  );

  const edges = useMemo(
    () =>
      measuring
        ? createPlaceMeasurementEdges({
            points: measurablePoints,
            selection: measureSelection,
            scaleFor: (from, to) => {
              const nodes = latestState.current.nodes;
              const first = nodes.find((node) => node.id === from);
              const second = nodes.find((node) => node.id === to);
              // Two points on the same laid-out map are read in that map's own
              // units; anything else in the units of the level they are on.
              return first && second ? scaleForPair(nodes, first, second, levelScale) : levelScale;
            },
            t,
          })
        : [],
    [measuring, measureSelection, measurablePoints, levelScale, t],
  );

  /**
   * What framing the level is supposed to show.
   *
   * A laid-out map is the ground, drawn at the size of the country it stands
   * for. Fitting to it frames a sheet of paper and pushes everything an author
   * put on it down to specks -- so the fit targets the places and the collapsed
   * maps, and lets the paper fall where it may. With nothing standing on the
   * level yet there is nothing to aim at, and framing everything is right again.
   */
  const fitTargets = useMemo(() => {
    // Held to the ground, the sheet is the world and framing it is framing
    // everything -- which is also what puts it in the middle of the view with
    // the surround evenly round it, so that it reads as the whole of the place
    // rather than as one more thing lying on a surface that carries on past it.
    if (ground && boundToGround) return [{ id: ground.id }];
    return [...nodes, ...pins].map((node) => ({ id: node.id }));
  }, [ground, boundToGround, nodes, pins]);
  const fitViewOptions = useMemo(
    // Capped at life size: fitting to a single card would otherwise magnify it
    // until the level around it is gone, which is the opposite of framing.
    () => ({ padding: 0.12, maxZoom: 1, ...(fitTargets.length ? { nodes: fitTargets } : {}) }),
    [fitTargets],
  );
  const latestFitOptions = useRef(fitViewOptions);
  latestFitOptions.current = fitViewOptions;

  /**
   * Where a drag came to rest decides what the place now belongs to.
   *
   * Dropped on a laid-out map, it becomes something standing on that map and is
   * remembered as a fraction of it -- which is what carries it along when the
   * map is later moved or resized. Dropped anywhere else, it goes back to being
   * a place on the level itself, positioned outright.
   */
  const commitDrag = useCallback(
    (
      node: {
        id: string;
        position: { x: number; y: number };
        measured?: { width?: number; height?: number };
      },
      pointer?: DragClientPoint,
    ) => {
      const { x, y } = node.position;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const current = latestState.current;
      const dragged = current.nodes.find((item) => item.id === node.id);
      if (!dragged) return;
      const pin = isPlaceDisplayPin(dragged);

      // An anchored place is drawn around its centre, so React Flow reports the centre too.
      // Everything else here works from the top-left corner -- a place only now being
      // dragged onto a map still comes from the level and reports the corner.
      const anchored =
        Boolean(latestGround.current) ||
        latestMaps.current.some((map) => map.id === dragged.parentPlaceId);
      const drop = placeDropFrame({
        pointer: dragged.mapExpanded && dragged.mapImageId ? undefined : pointer,
        position: { x, y },
        size: node.measured,
        anchored,
        pin,
      });

      const patch = placementForDrop({
        dragged,
        nodes: current.nodes,
        maps: latestMaps.current,
        levelId,
        levelGround: latestGround.current,
        position: drop.position,
        size: drop.size,
        // Only a map is held to the ruling, and only while the ruling is drawn.
        // A place is anchored as a fraction of whatever it stands on, so
        // rounding it would fight the thing that keeps it in place -- and
        // snapping to a grid nobody can see moves an author's work without
        // telling them.
        grid: snapToGrid ? GRID_SIZE : 0,
      });

      const next = {
        ...current,
        nodes: current.nodes.map((item) => (item.id === node.id ? { ...item, ...patch } : item)),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals([node.id]));
    },
    [levelId, onChange, snapToGrid, updateNodeInternals],
  );

  const previewForDrag = useCallback((event: MouseEvent | TouchEvent, node: PlaceFlowNode) => {
    const item = latestState.current.nodes.find((place) => place.id === node.id);
    const point = dragClientPoint(event);
    if (node.type !== "place" || !item || item.pinned || isExpandedMap(item) || !point) return;
    setDragPreview({ id: item.id, name: item.name, clientX: point.x, clientY: point.y });
  }, []);
  const startPlaceDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: PlaceFlowNode) => {
      dragSession.current = null;
      setDragPreview(null);
      setLivePosition(null);
      setFlowNodes(latestDerivedNodes.current);
      const item = latestState.current.nodes.find((place) => place.id === node.id);
      if (node.type !== "place" || !item || item.pinned || isExpandedMap(item)) return;
      dragSession.current = { id: node.id, cancelled: false };
      previewForDrag(event, node);
    },
    [previewForDrag],
  );
  const movePlaceDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: PlaceFlowNode) => {
      const session = dragSession.current;
      if (!session || session.cancelled || session.id !== node.id) return;
      previewForDrag(event, node);
    },
    [previewForDrag],
  );

  return {
    nodes: withMeasured([...(ground ? [ground] : []), ...maps, ...nodes, ...pins], measured).map(
      (node) =>
        node.id === dragPreview?.id && "measuring" in node.data
          ? ({ ...node, data: { ...node.data, dragPreview: true } } as PlaceFlowNode)
          : node,
    ),
    edges,
    fitViewOptions,
    zoomTier,
    dragPreview,
    addPlace: (overrides) => {
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
        ...overrides,
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
    snapToGrid,
    setSnapToGrid,
    picturesVisible,
    setPicturesVisible,
    boundToGround,
    setBoundToGround,
    hasGround: Boolean(levelGround),
    translateExtent,
    minZoom,
    onSurfaceResize: setSurface,
    onNodesChange: (changes) => {
      const current = latestFlowNodes.current;
      const session = dragSession.current;
      const acceptedChanges = changes.filter(
        (change) => !(session?.cancelled && change.type === "position" && change.id === session.id),
      );
      // A map is derived from the level rather than held in the flow's own list,
      // so applyNodeChanges has nothing to apply its movement to. Catching the
      // position here is what lets a map follow the pointer instead of standing
      // still and reappearing somewhere else when the pointer is let go.
      for (const change of acceptedChanges) {
        if (change.type !== "position" || !change.position) continue;
        // Anything the flow does not hold in its own list: a laid-out map, and a
        // card standing on one. Both are derived from the level, so this is the
        // only place their movement can be kept while the pointer is down.
        if (current.some((node) => node.id === change.id)) continue;
        const { x, y } = change.position;
        setLivePosition(change.dragging ? { id: change.id, x, y } : null);
      }
      setMeasured((known) => rememberMeasured(known, acceptedChanges));
      setFlowNodes((current) => applyNodeChanges(acceptedChanges, current));
    },
    onNodeDragStart: startPlaceDrag,
    onNodeDrag: movePlaceDrag,
    onNodeDragStop: (event, node) => {
      const session = dragSession.current;
      const cancelledEvent = event.type === "touchcancel" || event.type === "pointercancel";
      if (cancelledEvent && session) session.cancelled = true;
      dragSession.current = null;
      const client = dragClientPoint(event);
      const pointer = client ? flow.current?.screenToFlowPosition(client) : undefined;
      setDragPreview(null);
      setLivePosition(null);
      if (cancelledEvent || session?.cancelled || (session && session.id !== node.id)) {
        setFlowNodes(derivedNodes);
        return;
      }
      commitDrag(node, pointer);
    },
  };
}
