import type { Translate } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode, MapScale } from "../model";
import { cropOf, type ImageCrop } from "./placeImageCrop";
import type { PlaceMeasurementPoint } from "./placeMeasurementGraph";
import { formatDistance } from "./placeMap";
import type { PlaceGroundNode } from "./PlaceGround";
import type { PlaceMapFlowNode } from "./PlaceMapNode";
import {
  anchoredPoint,
  hasLevelContents,
  isPlace,
  type LevelRect,
  mapRect,
  spreadAnchor,
} from "./placeLevels";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";

export function createPlaceFlowNodes({
  nodes,
  places,
  measuring,
  measureSelection,
  onOpenLevel,
  onExpandMap,
  sourceUrl,
  host,
  zoomTier,
  viewportZoom,
  t,
}: {
  /** Every node in the world: what is inside a place lives outside this level. */
  nodes: FigureNode[];
  places: FigureNode[];
  /**
   * The ground these places stand on, when there is one.
   *
   * Given, positions come from each place's normalised anchor, which is what
   * carries them along when that ground is moved or resized. Absent -- a bare
   * grid with no picture under it -- they are placed outright.
   */
  host?: LevelRect;
  measuring: boolean;
  measureSelection: string[];
  onOpenLevel: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
  sourceUrl: (imageId: string) => string;
  zoomTier: SemanticZoomTier;
  viewportZoom: number;
  t: Translate;
}): PlaceFlowNode[] {
  const standing = places.filter((place) => !isExpandedMap(place));
  // Places made before this ground existed carry no anchor. Without a guess
  // they would all take the default one and pile up in a single spot.
  const guesses = new Map(
    standing.map((place, index) => [place.id, spreadAnchor(index, standing.length)]),
  );
  return standing.map((place) => ({
    id: place.id,
    type: "place",
    position: host ? anchoredPoint(place, host, guesses.get(place.id)) : placePosition(place),
    // Only ever spelled out when it is false. A node saying it is
    // draggable overrides the surface's own interactivity switch, which
    // is why the dock's lock left everything as movable as before.
    ...(place.pinned ? { draggable: false } : {}),
    ariaLabel: t("placeNodeLabel", { name: place.name }),
    // A group, not a button: the card carries its own controls now, and a
    // button holding buttons is a control nested in a control -- announced
    // wrongly by screen readers and a focus trap for anything assistive.
    // Focus still lands here, and Enter still picks the place up.
    ariaRole: "group",
    data: {
      place,
      measuring,
      measureStart: measuring && measureSelection.length === 1 && measureSelection[0] === place.id,
      filled: hasLevelContents(nodes, place.id),
      ...(place.mapImageId ? { mapPreview: sourceUrl(place.mapImageId) } : {}),
      onOpenLevel,
      onExpandMap,
      zoomTier,
      zoom: viewportZoom,
    },
  }));
}

/**
 * How wide a new map is drawn before anybody resizes it, in flow units.
 *
 * Wide enough to be the ground rather than another card on it: a place card
 * is about two hundred across, so this is a surface a dozen of them can stand
 * on without crowding.
 */
export const DEFAULT_MAP_WIDTH = 2400;

/** Whether this place is drawn as an opened-out map rather than as a card. */
export function isExpandedMap(place: FigureNode): boolean {
  return Boolean(place.mapExpanded && place.mapImageId);
}

/**
 * The maps opened out on this level.
 *
 * A place is drawn either as a card or as a map, never as both, so the two
 * builders split the same list between them.
 */
export function createPlaceMapNodes({
  places,
  sourceUrl,
  onResize,
  onResizeLive,
  onCropDraft,
  onCropCommit,
  cropOverride,
  adjustingId,
  liveSize,
  livePosition,
  gridSize,
  zoom,
  picturesVisible,
  gridVisible,
}: {
  places: FigureNode[];
  sourceUrl: (imageId: string) => string;
  onResize: (place: FigureNode, size: { width: number; height: number }) => void;
  onResizeLive: (place: FigureNode, size: { width: number; height: number }) => void;
  onCropDraft: (place: FigureNode, crop: ImageCrop) => void;
  onCropCommit: (place: FigureNode, crop: ImageCrop) => void;
  /** The crop being dragged right now, which has not been written down yet. */
  cropOverride: { id: string; crop: ImageCrop } | null;
  adjustingId: string | undefined;
  /**
   * The size a handle is being dragged to right now.
   *
   * Map nodes are derived rather than kept in the flow's own list, so React Flow
   * drops the dimension changes it reports while a handle is held and the map
   * would only jump to its new size on release.
   */
  liveSize: { id: string; width: number; height: number } | null;
  /**
   * Where a handle is dragging this map right now.
   *
   * Same reason as the size above: React Flow reports the position it is
   * dragging a node to as a change, and a derived node is not in the list those
   * changes are applied to, so the map would sit still and then appear at its
   * new place the moment the pointer is released.
   */
  livePosition: { id: string; x: number; y: number } | null;
  gridSize: number;
  /** What the canvas is magnified by right now. */
  zoom: number;
  /** Whether the pictures are drawn, or only the ground they rule. */
  picturesVisible: boolean;
  /** Whether the ruling is drawn over them. */
  gridVisible: boolean;
}): PlaceMapFlowNode[] {
  return places.filter(isExpandedMap).map((place) => {
    const live = liveSize?.id === place.id ? liveSize : undefined;
    const moved = livePosition?.id === place.id ? livePosition : undefined;
    return {
      id: place.id,
      type: "placeMap",
      position: moved ? { x: moved.x, y: moved.y } : placePosition(place),
      width: live?.width ?? place.mapWidth ?? DEFAULT_MAP_WIDTH,
      height: live?.height ?? place.mapHeight ?? DEFAULT_MAP_WIDTH,
      ...(place.pinned ? { draggable: false } : {}),
      // Behind the cards that stand on it.
      zIndex: -1,
      data: {
        place,
        // Where this sheet sits, so the lines drawn on it can be ruled from the
        // level's origin rather than from the sheet's own corner.
        origin: moved ? { x: moved.x, y: moved.y } : placePosition(place),
        source: picturesVisible ? sourceUrl(place.mapImageId as string) : "",
        crop: cropOverride?.id === place.id ? cropOverride.crop : cropOf(place),
        adjusting: adjustingId === place.id,
        onResize,
        onResizeLive,
        onCropDraft,
        onCropCommit,
        gridSize,
        gridVisible,
        zoom,
      },
    };
  });
}

/**
 * Everything on the level that a distance can be taken to.
 *
 * Not only the cards sitting on the level itself. A place standing on a
 * laid-out map is drawn here, on the map, though it belongs to that map's own
 * level -- so leaving those out made the things most obviously on the surface
 * the only ones that could not be measured. A map counts too: it is a piece of
 * ground with a position, and how far a place lies from it is an ordinary
 * question to ask.
 *
 * A card is taken at its corner, where its anchor sits. A map is taken at its
 * middle, because a sheet has no corner that stands for the whole of it.
 */
export function createMeasurementPoints(
  cards: readonly PlaceFlowNode[],
  maps: readonly FigureNode[],
): PlaceMeasurementPoint[] {
  return [
    ...cards.map((card) => ({
      id: card.id,
      name: card.data.place.name,
      mapX: card.position.x,
      mapY: card.position.y,
    })),
    ...maps.map((map) => {
      const rect = mapRect(map);
      return {
        id: map.id,
        name: map.name,
        mapX: rect.x + rect.width / 2,
        mapY: rect.y + rect.height / 2,
      };
    }),
  ];
}

/**
 * The places standing on the maps laid out on this level.
 *
 * They belong to the map, not to the level, so they are found by looking one
 * step further in than `placesOnLevel` goes. Their position is derived from the
 * map's rectangle and their own normalised anchor, which is what carries them
 * along when the map underneath is moved or resized.
 */
export function createPinNodes({
  nodes,
  maps,
  measuring,
  measureSelection,
  onOpenLevel,
  onExpandMap,
  sourceUrl,
  zoomTier,
  viewportZoom,
  t,
}: {
  nodes: FigureNode[];
  maps: FigureNode[];
  measuring: boolean;
  measureSelection: string[];
  onOpenLevel: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
  sourceUrl: (imageId: string) => string;
  zoomTier: SemanticZoomTier;
  viewportZoom: number;
  t: Translate;
}): PlaceFlowNode[] {
  return maps.flatMap((map) =>
    createPlaceFlowNodes({
      nodes,
      places: nodes.filter((node) => isPlace(node) && node.parentPlaceId === map.id),
      measuring,
      measureSelection,
      onOpenLevel,
      onExpandMap,
      sourceUrl,
      host: mapRect(map),
      zoomTier,
      viewportZoom,
      t,
    }),
  );
}

/** Where the open level's own picture is laid, when it carries one. */
export function groundRect(level: FigureNode | undefined): LevelRect | undefined {
  if (!level?.mapImageId) return undefined;
  return {
    x: 0,
    y: 0,
    width: level.mapWidth ?? DEFAULT_MAP_WIDTH,
    height: level.mapHeight ?? DEFAULT_MAP_WIDTH,
  };
}

/**
 * The picture under everything on the open level.
 *
 * Entering a map lands you on that map rather than on the bare grid it was filed
 * under, and the places it holds are then positioned against this rectangle.
 */
export function createGroundNode({
  level,
  sourceUrl,
  gridSize,
  zoom,
  picturesVisible,
  gridVisible,
}: {
  level: FigureNode | undefined;
  sourceUrl: (imageId: string) => string;
  gridSize: number;
  zoom: number;
  picturesVisible: boolean;
  gridVisible: boolean;
}): PlaceGroundNode | undefined {
  const rect = groundRect(level);
  if (!rect || !level?.mapImageId) return undefined;
  return {
    id: `ground:${level.id}`,
    type: "placeGround",
    position: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    // Under the maps, which are themselves under the cards.
    zIndex: -2,
    data: {
      source: picturesVisible ? sourceUrl(level.mapImageId) : "",
      title: level.name,
      gridSize,
      gridVisible,
      zoom,
    },
  };
}
