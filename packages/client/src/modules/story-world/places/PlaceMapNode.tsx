import type { Node, NodeProps } from "@xyflow/react";
import { ChevronsDownUp, CornerDownRight } from "lucide-react";
import { IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./PlaceMapNode.css";

export type PlaceMapNodeData = {
  place: FigureNode;
  source: string;
  onCollapse: (place: FigureNode) => void;
  onOpenLevel: (place: FigureNode) => void;
};

export type PlaceMapFlowNode = Node<PlaceMapNodeData>;

/**
 * A map laid out on the surface: the same place as the card, opened out.
 *
 * It rides in the flow as a node so it pans, zooms and drags with everything
 * standing on it. Collapsing turns it back into a card without changing what it
 * is -- only how much room it takes.
 */
export function PlaceMapNode({ data, selected }: NodeProps<PlaceMapFlowNode>) {
  const { t } = useI18n();
  const place = data.place;
  return (
    <figure className={`place-map-node ${selected ? "is-selected" : ""}`}>
      <img src={data.source} alt={place.name} draggable={false} />
      <figcaption className="place-map-node__bar">
        <span className="place-map-node__name">{place.name}</span>
        <IconButton
          className="place-map-node__action nodrag nopan"
          size="compact"
          appearance="ghost"
          label={t("placeCollapseMap", { name: place.name })}
          icon={<ChevronsDownUp />}
          onClick={(event) => {
            event.stopPropagation();
            data.onCollapse(place);
          }}
        />
        <IconButton
          className="place-map-node__action nodrag nopan"
          size="compact"
          appearance="ghost"
          label={t("placeOpenLevel", { name: place.name })}
          icon={<CornerDownRight />}
          onClick={(event) => {
            event.stopPropagation();
            data.onOpenLevel(place);
          }}
        />
      </figcaption>
    </figure>
  );
}
