import { type Node, NodeResizer, type NodeProps } from "@xyflow/react";
import { ChevronsDownUp } from "lucide-react";
import { IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./PlaceMapNode.css";

export type PlaceMapNodeData = {
  place: FigureNode;
  source: string;
  onCollapse: (place: FigureNode) => void;
  onResize: (place: FigureNode, size: { width: number; height: number }) => void;
  /** What this map's width comes to in the author's own units. */
  measured: string;
};

export type PlaceMapFlowNode = Node<PlaceMapNodeData>;

/**
 * A map laid out on the surface: the same place as the card, opened out.
 *
 * It rides in the flow as a node so it pans, zooms and drags with everything
 * standing on it. Collapsing turns it back into a card without changing what it
 * is -- only how much room it takes.
 *
 * There is no way in from here, deliberately: laid out, the map already shows
 * what is inside it. Going in is what a collapsed card offers, and offering both
 * would be two doors into the same room.
 */
export function PlaceMapNode({ data, selected }: NodeProps<PlaceMapFlowNode>) {
  const { t } = useI18n();
  const place = data.place;
  return (
    <figure className={`place-map-node ${selected ? "is-selected" : ""}`}>
      {/* Resizing a map is how its scale is declared: making it wider says the
          same picture covers more ground. The places standing on it are held as
          fractions of it, so they travel with the change instead of drifting. */}
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        handleClassName="place-map-node__handle"
        lineClassName="place-map-node__line"
        onResizeEnd={(_, size) => data.onResize(place, { width: size.width, height: size.height })}
      />
      <img src={data.source} alt={place.name} draggable={false} />
      <figcaption className="place-map-node__bar">
        <span className="place-map-node__name">{place.name}</span>
        {/* Resizing a map is how far it reaches across the world; saying so
            while the handle is held is what makes that a measurement rather
            than a guess. */}
        <span className="place-map-node__measure">{data.measured}</span>
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
      </figcaption>
    </figure>
  );
}
