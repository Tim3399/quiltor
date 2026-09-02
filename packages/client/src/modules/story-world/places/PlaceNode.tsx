import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ChevronsUpDown, CornerDownRight, Plus, Star } from "lucide-react";
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
  /** Where this place's map can be shown from, when it has one. */
  mapPreview?: string;
  onOpenLevel: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
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
          item.mapImageId ? "is-map" : "",
          data.measuring ? "is-measuring" : "",
          data.measureStart ? "is-measure-start" : "",
        ]}
      >
        {data.mapPreview && data.zoomTier !== "overview" ? (
          // The preview is the signal: a place with a map looks different from
          // one without, without a badge or a label saying so.
          <span className="place-node__preview" aria-hidden="true">
            <img src={data.mapPreview} alt="" draggable={false} />
          </span>
        ) : null}
        <StoryNodeIdentity
          // It says what it is. A sheet you lay places onto is not one of them.
          kindLabel={item.mapImageId ? t("mapKind") : t("place")}
          name={item.name}
          leading={
            item.important ? (
              <Star className="importance-mark" aria-label={t("favoritePlaceMarker")} />
            ) : undefined
          }
          // A map card carries its picture, not a description of a place: the
          // field that would edit this is not offered for a map, so showing it
          // would put text on the card that nothing can reach.
          secondary={item.mapImageId ? undefined : item.sub}
        />
        {data.zoomTier !== "overview" && !data.measuring && item.mapImageId ? (
          <IconButton
            className="place-node__enter nodrag nopan"
            size="compact"
            appearance="ghost"
            label={t("placeExpandMap", { name: item.name })}
            icon={<ChevronsUpDown />}
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandMap(item);
            }}
          />
        ) : null}
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
