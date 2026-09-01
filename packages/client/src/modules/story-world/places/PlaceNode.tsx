import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { CornerDownRight, Plus, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import { StoryNodeCard, StoryNodeIdentity } from "../StoryNodeCard";
import { IconButton } from "../../../design";
import "./PlaceNode.css";

export type PlaceCardData = {
  place: FigureNode;
  measuring: boolean;
  measureStart: boolean;
  /** Whether anything is inside, which decides what the card offers. */
  filled: boolean;
  onOpenLevel: (place: FigureNode) => void;
  zoomTier: SemanticZoomTier;
  zoom: number;
};

export type PlaceFlowNode = Node<PlaceCardData>;

export const placeNodeTypes = { place: PlaceNode };

const placeCoordinateHandleStyle = {
  top: 6,
  right: "auto",
  bottom: "auto",
  left: 6,
  transform: "translate(-50%, -50%)",
} satisfies CSSProperties;

export function PlaceNode({ data, selected }: NodeProps<PlaceFlowNode>) {
  const { t } = useI18n();
  const item = data.place;
  return (
    <div className="place-node-shell">
      <Handle
        id="place-anchor"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <Handle
        id="place-anchor"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <StoryNodeCard
        zoomTier={data.zoomTier}
        viewportZoom={data.zoom}
        kind="ort"
        important={!!item.important}
        selected={selected}
        modifiers={[
          data.measuring ? "is-measuring" : "",
          data.measureStart ? "is-measure-start" : "",
        ]}
      >
        <StoryNodeIdentity
          kindLabel={t("place")}
          name={item.name}
          leading={
            item.important ? (
              <Star className="importance-mark" aria-label={t("favoritePlaceMarker")} />
            ) : undefined
          }
          secondary={item.sub}
        />
        {data.zoomTier !== "overview" && !data.measuring ? (
          <IconButton
            className="place-node__enter nodrag nopan"
            size="compact"
            appearance="ghost"
            label={
              data.filled
                ? t("placeOpenLevel", { name: item.name })
                : t("placeStartLevel", { name: item.name })
            }
            icon={data.filled ? <CornerDownRight /> : <Plus />}
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenLevel(item);
            }}
          />
        ) : null}
      </StoryNodeCard>
    </div>
  );
}

export function placePosition(place: FigureNode) {
  return { x: place.mapX ?? place.x, y: place.mapY ?? place.y };
}
