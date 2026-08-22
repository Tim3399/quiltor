import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Star } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import "./PlaceNode.css";

export type PlaceCardData = {
  place: FigureNode;
  measuring: boolean;
  measureStart: boolean;
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
  const semanticScale = data.zoomTier === "overview" ? 1 / Math.max(data.zoom, 0.08) : 1;
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
      <div
        style={{ "--semantic-scale": semanticScale } as CSSProperties}
        className={`story-node zoom-${data.zoomTier} type-ort accent-${item.accent || "ink"} ${item.important ? "is-important" : ""} ${data.measuring ? "is-measuring" : ""} ${data.measureStart ? "is-measure-start" : ""} ${selected ? "selected" : ""}`}
      >
        <span className="node-kind">{t("place")}</span>
        <strong>
          {item.important && (
            <Star className="importance-mark" aria-label={t("favoritePlaceMarker")} />
          )}
          {item.name}
        </strong>
        {item.sub && <small>{item.sub}</small>}
      </div>
    </div>
  );
}

export function placePosition(place: FigureNode) {
  return { x: place.mapX ?? place.x, y: place.mapY ?? place.y };
}
