import type { Translate } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import { hasLevelContents } from "./placeLevels";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";

export function createPlaceFlowNodes({
  nodes,
  places,
  measuring,
  measureSelection,
  onOpenLevel,
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
  zoomTier: SemanticZoomTier;
  viewportZoom: number;
  t: Translate;
}): PlaceFlowNode[] {
  return places.map((place) => ({
    id: place.id,
    type: "place",
    position: placePosition(place),
    draggable: !place.pinned,
    ariaLabel: t("placeNodeLabel", { name: place.name }),
    ariaRole: "button",
    data: {
      place,
      measuring,
      measureStart: measuring && measureSelection.length === 1 && measureSelection[0] === place.id,
      filled: hasLevelContents(nodes, place.id),
      onOpenLevel,
      zoomTier,
      zoom: viewportZoom,
    },
  }));
}
