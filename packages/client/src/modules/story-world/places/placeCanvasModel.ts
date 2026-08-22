import type { Translate } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import { type PlaceFlowNode, placePosition } from "./PlaceNode";

export function createPlaceFlowNodes({
  places,
  measuring,
  measureSelection,
  zoomTier,
  viewportZoom,
  t,
}: {
  places: FigureNode[];
  measuring: boolean;
  measureSelection: string[];
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
      zoomTier,
      zoom: viewportZoom,
    },
  }));
}
