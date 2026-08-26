import { Handle, type MiniMapNodeProps, type Node, type NodeProps, Position } from "@xyflow/react";
import { Skull, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../../i18n";
import type { FigureKind, FigureNode as FigureNodeModel } from "../model";
import { StoryNodeCard } from "../StoryNodeCard";
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
  const semanticScale = data.zoomTier === "overview" ? 1 / Math.max(data.zoom, 0.08) : 1;
  return (
    <StoryNodeCard
      zoomTier={data.zoomTier}
      kind={item.type || "person"}
      accent={item.accent || "ink"}
      important={!!item.important}
      dashed={!!item.dash}
      selected={selected}
      modifiers={[data.deceased ? "is-deceased" : "", data.guests.length ? "has-guests" : ""]}
      style={{ "--semantic-scale": semanticScale } as CSSProperties}
    >
      <Handle
        id="in"
        className="directed-handle incoming-handle"
        type="target"
        position={Position.Left}
      />
      <Handle id="neutral-top" className="neutral-handle" type="source" position={Position.Top} />
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
      <span className="node-kind">
        {item.type !== "person" ? kindLabel(item.type, t) : item.label || t("figure")}
      </span>
      <span className="node-monogram" aria-hidden="true">
        {item.name.trim().charAt(0).toLocaleUpperCase()}
      </span>
      <strong>
        {item.important && <Star className="importance-mark" aria-label={t("important")} />}
        {item.name}
        {data.deceased && <Skull aria-label={t("deceased")} />}
      </strong>
      {item.sub && <small>{item.sub}</small>}
      {data.guests.length > 0 && (
        <small className="node-guests">
          {data.guests
            .slice(0, 3)
            .map((guest) => guest.name)
            .join(", ")}
          {data.guests.length > 3 ? ` +${data.guests.length - 3}` : ""}
        </small>
      )}
      <Handle
        id="out"
        className="directed-handle outgoing-handle"
        type="source"
        position={Position.Right}
      />
      <Handle
        id="neutral-bottom"
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
  if (kind === "ort") return "var(--minimap-place)";
  if (kind === "konzept") return "var(--minimap-concept)";
  if (kind === "tier") return "var(--minimap-animal)";
  if (kind === "organisation") return "var(--minimap-organisation)";
  if (kind === "objekt") return "var(--minimap-object)";
  return "var(--minimap-person)";
}
