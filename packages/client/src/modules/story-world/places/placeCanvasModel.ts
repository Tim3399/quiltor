import type { Translate } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import type { PlaceMapFlowNode } from "./PlaceMapNode";
import { anchoredPoint, hasLevelContents, isPlace, mapRect, spreadAnchor } from "./placeLevels";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";

export function createPlaceFlowNodes({
  nodes,
  places,
  measuring,
  measureSelection,
  onOpenLevel,
  onExpandMap,
  sourceUrl,
  zoomTier,
  viewportZoom,
  t,
}: {
  /** Every node in the world: what is inside a place lives outside this level. */
  nodes: FigureNode[];
  places: FigureNode[];
  measuring: boolean;
  measureSelection: string[];
  onOpenLevel: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
  sourceUrl: (imageId: string) => string;
  zoomTier: SemanticZoomTier;
  viewportZoom: number;
  t: Translate;
}): PlaceFlowNode[] {
  return places
    .filter((place) => !isExpandedMap(place))
    .map((place) => ({
      id: place.id,
      type: "place",
      position: placePosition(place),
      draggable: !place.pinned,
      ariaLabel: t("placeNodeLabel", { name: place.name }),
      ariaRole: "button",
      data: {
        place,
        measuring,
        measureStart:
          measuring && measureSelection.length === 1 && measureSelection[0] === place.id,
        filled: hasLevelContents(nodes, place.id),
        ...(place.mapImageId ? { mapPreview: sourceUrl(place.mapImageId) } : {}),
        onOpenLevel,
        onExpandMap,
        zoomTier,
        zoom: viewportZoom,
      },
    }));
}

/** How wide a new map is drawn before anybody resizes it, in flow units. */
export const DEFAULT_MAP_WIDTH = 1200;

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
  onCollapse,
  onOpenLevel,
  onResize,
}: {
  places: FigureNode[];
  sourceUrl: (imageId: string) => string;
  onCollapse: (place: FigureNode) => void;
  onOpenLevel: (place: FigureNode) => void;
  onResize: (place: FigureNode, size: { width: number; height: number }) => void;
}): PlaceMapFlowNode[] {
  return places.filter(isExpandedMap).map((place) => ({
    id: place.id,
    type: "placeMap",
    position: placePosition(place),
    width: place.mapWidth ?? DEFAULT_MAP_WIDTH,
    height: place.mapHeight ?? DEFAULT_MAP_WIDTH,
    draggable: !place.pinned,
    // Behind the cards that stand on it.
    zIndex: -1,
    data: {
      place,
      source: sourceUrl(place.mapImageId as string),
      onCollapse,
      onOpenLevel,
      onResize,
    },
  }));
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
  return maps.flatMap((map) => {
    const rect = mapRect(map);
    const standing = nodes.filter((node) => isPlace(node) && node.parentPlaceId === map.id);
    // A level opened out into a map for the first time has places on it that
    // never needed an anchor. Without a guess they would all take the default
    // one and pile up in the middle.
    const guesses = new Map(
      standing.map((place, index) => [place.id, spreadAnchor(index, standing.length)]),
    );
    return createPlaceFlowNodes({
      nodes,
      places: standing,
      measuring,
      measureSelection,
      onOpenLevel,
      onExpandMap,
      sourceUrl,
      zoomTier,
      viewportZoom,
      t,
    }).map((pin) => ({
      ...pin,
      position: anchoredPoint(
        nodes.find((node) => node.id === pin.id) as FigureNode,
        rect,
        guesses.get(pin.id),
      ),
    }));
  });
}
