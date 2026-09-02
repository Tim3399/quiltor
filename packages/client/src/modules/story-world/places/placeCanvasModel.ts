import type { Translate } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode, MapScale } from "../model";
import { cropOf, type ImageCrop } from "./placeImageCrop";
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
    draggable: !place.pinned,
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
      draggable: !place.pinned,
      // Behind the cards that stand on it.
      zIndex: -1,
      data: {
        place,
        source: sourceUrl(place.mapImageId as string),
        crop: cropOverride?.id === place.id ? cropOverride.crop : cropOf(place),
        adjusting: adjustingId === place.id,
        onResize,
        onResizeLive,
        onCropDraft,
        onCropCommit,
        gridSize,
      },
    };
  });
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
}: {
  level: FigureNode | undefined;
  sourceUrl: (imageId: string) => string;
  gridSize: number;
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
    data: { source: sourceUrl(level.mapImageId), title: level.name, gridSize },
  };
}
