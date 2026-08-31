import { Handle, type MiniMapNodeProps, type Node, type NodeProps, Position } from "@xyflow/react";
import { Skull, Star } from "lucide-react";
import { useI18n } from "../../../i18n";
import { cardKindColor, GRAPH_CONNECTION_HANDLES } from "../../graph";
import type { FigureKind, FigureNode as FigureNodeModel } from "../model";
import { StoryNodeCard, StoryNodeIdentity } from "../StoryNodeCard";
import { kindLabel, type SemanticZoomTier } from "./relationships";

export type FigureCardData = {
  figure: FigureNodeModel;
  deceased: boolean;
  guests: FigureNodeModel[];
  zoomTier: SemanticZoomTier;
  zoom: number;
};

export type FigureFlowNode = Node<FigureCardData>;

export const figureNodeTypes = { story: StoryNode };

export function StoryNode({ data, selected }: NodeProps<FigureFlowNode>) {
  const { t } = useI18n();
  const item = data.figure;
  return (
    <StoryNodeCard
      zoomTier={data.zoomTier}
      viewportZoom={data.zoom}
      kind={item.type || "person"}
      important={!!item.important}
      dashed={!!item.dash}
      selected={selected}
      modifiers={[data.deceased ? "is-deceased" : "", data.guests.length ? "has-guests" : ""]}
    >
      <Handle
        id={GRAPH_CONNECTION_HANDLES.incoming}
        className="directed-handle incoming-handle"
        type="target"
        position={Position.Left}
      />
      <Handle
        id={GRAPH_CONNECTION_HANDLES.neutralTop}
        className="neutral-handle"
        type="source"
        position={Position.Top}
      />
      <Handle
        id="journey-top"
        className="journey-handle"
        type="source"
        position={Position.Top}
        isConnectable={false}
      />
      <Handle
        id="journey-bottom"
        className="journey-handle"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
      />
      <StoryNodeIdentity
        kindLabel={item.type !== "person" ? kindLabel(item.type, t) : item.label || t("figure")}
        name={item.name}
        leading={
          item.important ? (
            <Star className="importance-mark" aria-label={t("important")} />
          ) : undefined
        }
        trailing={data.deceased ? <Skull aria-label={t("deceased")} /> : undefined}
        secondary={item.sub}
      >
        {data.guests.length > 0 && (
          <small className="node-guests">
            {data.guests
              .slice(0, 3)
              .map((guest) => guest.name)
              .join(", ")}
            {data.guests.length > 3 ? ` +${data.guests.length - 3}` : ""}
          </small>
        )}
      </StoryNodeIdentity>
      <Handle
        id={GRAPH_CONNECTION_HANDLES.outgoing}
        className="directed-handle outgoing-handle"
        type="source"
        position={Position.Right}
      />
      <Handle
        id={GRAPH_CONNECTION_HANDLES.neutralBottom}
        className="neutral-handle"
        type="source"
        position={Position.Bottom}
      />
    </StoryNodeCard>
  );
}

export function FigureMiniMapNode({
  x,
  y,
  width,
  height,
  color,
  strokeColor,
  strokeWidth,
  borderRadius,
  className,
  selected,
}: MiniMapNodeProps) {
  return (
    <rect
      className={`react-flow__minimap-node ${selected ? "selected" : ""} ${className ?? ""}`}
      x={x}
      y={y}
      width={width}
      height={height}
      rx={borderRadius}
      ry={borderRadius}
      style={{ fill: color, stroke: strokeColor, strokeWidth }}
    />
  );
}

export function minimapColorForKind(kind?: FigureKind) {
  return cardKindColor(kind ?? "person");
}
