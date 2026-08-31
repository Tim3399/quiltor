import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  type Node,
  Position,
  useStore,
} from "@xyflow/react";
import { Clock3, GitFork } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "../../design";
import { GRAPH_CONNECTION_HANDLES } from "./connectionModel";
import {
  type GraphPoint,
  type GraphRect,
  type GraphSize,
  placeGraphEdgeLabels,
  sampleGraphSmoothStepPath,
} from "./edgeLabelPlacement";
import { GRAPH_RELATIONSHIP_EDGE_TYPE } from "./edgePresentation";
import "./GraphRelationshipEdge.css";

const FALLBACK_NODE_SIZE = { width: 200, height: 96 } as const;
const LABEL_HEIGHT = 24;
const LABEL_MIN_WIDTH = 44;
const LABEL_MAX_WIDTH = 220;
const INTERACTIVE_TARGET_SIZE = 44;
const JOURNEY_HANDLE_INLINE_RATIO = 0.26;

export type GraphEdgeLabelBadge = "kinship" | "temporal";

type GraphLabelNode = Pick<Node, "id" | "position"> &
  Partial<Pick<Node, "data" | "measured" | "width" | "height" | "style">>;

export type GraphRelationshipEdgeData = {
  [key: string]: unknown;
  labelPlacement?: { x: number; y: number };
  labelSize?: GraphSize;
  labelCollisionFallback?: boolean;
  labelPathRatio?: number;
  pathData?: string;
  labelBadges?: readonly GraphEdgeLabelBadge[];
  labelTitle?: string;
  onLabelClick?: (edgeId: string) => void;
};

export type GraphRelationshipFlowEdge = Edge<
  GraphRelationshipEdgeData,
  typeof GRAPH_RELATIONSHIP_EDGE_TYPE
>;

function numericDimension(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || !value.endsWith("px")) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function nodeSize(node: GraphLabelNode): GraphSize {
  return {
    width:
      node.measured?.width ??
      node.width ??
      numericDimension(node.style?.width) ??
      FALLBACK_NODE_SIZE.width,
    height:
      node.measured?.height ??
      node.height ??
      numericDimension(node.style?.height) ??
      FALLBACK_NODE_SIZE.height,
  };
}

function nodeObstacle(node: GraphLabelNode) {
  const size = nodeSize(node);
  const data = (node.data ?? {}) as {
    guests?: readonly unknown[];
    item?: { kind?: string };
  };
  const isStoryboardGroup = data.item?.kind === "group";
  return {
    x: node.position.x,
    y: node.position.y,
    width: size.width,
    // A group is a container. Only its named header is content that labels
    // must avoid; treating the full group as blocked would eject internal labels.
    height: isStoryboardGroup
      ? Math.min(size.height, 52)
      : size.height + (data.guests?.length ? 22 : 0),
  };
}

function graphHandleAnchor(
  rect: GraphRect,
  handleId: string | null | undefined,
  role: "source" | "target",
): { point: GraphPoint; position: Position } {
  const horizontalCenter = rect.x + rect.width / 2;
  const verticalCenter = rect.y + rect.height / 2;
  switch (handleId) {
    case GRAPH_CONNECTION_HANDLES.incoming:
      return { point: { x: rect.x, y: verticalCenter }, position: Position.Left };
    case GRAPH_CONNECTION_HANDLES.outgoing:
      return {
        point: { x: rect.x + rect.width, y: verticalCenter },
        position: Position.Right,
      };
    case GRAPH_CONNECTION_HANDLES.neutralTop:
      return { point: { x: horizontalCenter, y: rect.y }, position: Position.Top };
    case GRAPH_CONNECTION_HANDLES.neutralBottom:
      return {
        point: { x: horizontalCenter, y: rect.y + rect.height },
        position: Position.Bottom,
      };
    case "journey-top":
      return {
        point: { x: rect.x + rect.width * JOURNEY_HANDLE_INLINE_RATIO, y: rect.y },
        position: Position.Top,
      };
    case "journey-bottom":
      return {
        point: {
          x: rect.x + rect.width * JOURNEY_HANDLE_INLINE_RATIO,
          y: rect.y + rect.height,
        },
        position: Position.Bottom,
      };
    default:
      return role === "source"
        ? {
            point: { x: rect.x + rect.width, y: verticalCenter },
            position: Position.Right,
          }
        : { point: { x: rect.x, y: verticalCenter }, position: Position.Left };
  }
}

function graphEdgeRoute(edge: Edge, sourceRect: GraphRect, targetRect: GraphRect) {
  const source = graphHandleAnchor(sourceRect, edge.sourceHandle, "source");
  const target = graphHandleAnchor(targetRect, edge.targetHandle, "target");
  const [pathData, labelX, labelY] = getSmoothStepPath({
    sourceX: source.point.x,
    sourceY: source.point.y,
    sourcePosition: source.position,
    targetX: target.point.x,
    targetY: target.point.y,
    targetPosition: target.position,
  });
  return {
    source: source.point,
    target: target.point,
    idealCenter: { x: labelX, y: labelY },
    pathData,
    pathPoints: sampleGraphSmoothStepPath(pathData),
  };
}

export function graphEdgeLabelSize(label: string, badgeCount = 0): GraphSize {
  const normalizedLength = Array.from(label.trim().replace(/\s+/g, " ")).length;
  const badgeWidth = badgeCount ? badgeCount * 14 + (normalizedLength ? 6 : 0) : 0;
  return {
    width: Math.min(
      LABEL_MAX_WIDTH,
      Math.max(LABEL_MIN_WIDTH, 18 + normalizedLength * 6.5 + badgeWidth),
    ),
    height: LABEL_HEIGHT,
  };
}

/**
 * Adds deterministic label positions to relationship edges in unscaled Flow
 * coordinates. Keeping this outside the renderer makes all labels participate
 * in one collision pass, including parallel edges.
 */
export function positionGraphRelationshipEdgeLabels<EdgeType extends Edge>(
  nodes: readonly GraphLabelNode[],
  edges: readonly EdgeType[],
  options: { onLabelClick?: (edgeId: string) => void } = {},
): EdgeType[] {
  const nodeRects = new Map(
    nodes.map((node) => {
      const size = nodeSize(node);
      return [
        node.id,
        { x: node.position.x, y: node.position.y, width: size.width, height: size.height },
      ] as const;
    }),
  );
  const obstacles = nodes.map(nodeObstacle);
  const routes = new Map<string, ReturnType<typeof graphEdgeRoute>>();
  const requests = edges.flatMap((edge) => {
    const label = typeof edge.label === "string" ? edge.label.trim() : "";
    const badges = ((edge.data as GraphRelationshipEdgeData | undefined)?.labelBadges ?? []).filter(
      (badge): badge is GraphEdgeLabelBadge => badge === "kinship" || badge === "temporal",
    );
    if (edge.type !== GRAPH_RELATIONSHIP_EDGE_TYPE || (!label && !badges.length)) return [];
    const sourceRect = nodeRects.get(edge.source);
    const targetRect = nodeRects.get(edge.target);
    if (!sourceRect || !targetRect) return [];
    const route = graphEdgeRoute(edge, sourceRect, targetRect);
    routes.set(edge.id, route);
    return [
      {
        id: edge.id,
        source: route.source,
        target: route.target,
        idealCenter: route.idealCenter,
        size: graphEdgeLabelSize(label, badges.length),
        pathPoints: route.pathPoints,
      },
    ];
  });
  if (!requests.length) return [...edges];

  const placements = placeGraphEdgeLabels(requests, obstacles);
  return edges.map((edge) => {
    const placement = placements.get(edge.id);
    const route = routes.get(edge.id);
    if (!placement || !route) return edge;
    return {
      ...edge,
      data: {
        ...(edge.data ?? {}),
        labelPlacement: placement.center,
        labelSize: { width: placement.bounds.width, height: placement.bounds.height },
        labelCollisionFallback: placement.collides,
        labelPathRatio: placement.pathRatio,
        pathData: route.pathData,
        ...(edge.selectable === false || !options.onLabelClick
          ? {}
          : { onLabelClick: options.onLabelClick }),
      },
    } as EdgeType;
  });
}

function cssToken(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function visibleLabel(label: ReactNode): string | null {
  if (typeof label !== "string") return null;
  const normalized = label.trim().replace(/\s+/g, " ");
  return normalized || null;
}

type InteractiveGraphEdgeLabelProps = {
  id: string;
  className: string;
  labelTitle?: string;
  labelSize?: GraphSize;
  positionStyle: CSSProperties;
  onLabelClick: (edgeId: string) => void;
  children: ReactNode;
};

function InteractiveGraphEdgeLabel({
  id,
  className,
  labelTitle,
  labelSize,
  positionStyle,
  onLabelClick,
  children,
}: InteractiveGraphEdgeLabelProps) {
  const viewportZoom = useStore((state) => state.transform[2]);
  const safeViewportZoom = viewportZoom > 0 ? viewportZoom : 1;
  const hitTargetSize = labelSize
    ? {
        width: Math.max(labelSize.width, INTERACTIVE_TARGET_SIZE / safeViewportZoom),
        height: Math.max(labelSize.height, INTERACTIVE_TARGET_SIZE / safeViewportZoom),
      }
    : undefined;
  const hitTargetStyle = hitTargetSize
    ? {
        ...positionStyle,
        width: `${hitTargetSize.width}px`,
        height: `${hitTargetSize.height}px`,
        minWidth: `${hitTargetSize.width}px`,
        minHeight: `${hitTargetSize.height}px`,
      }
    : positionStyle;

  return (
    <Button
      appearance="ghost"
      size="compact"
      labelOverflow="visible"
      className={className}
      data-edge-label-id={id}
      aria-label={labelTitle}
      title={labelTitle}
      style={hitTargetStyle}
      onClick={(event) => {
        event.stopPropagation();
        onLabelClick(id);
      }}
    >
      {children}
    </Button>
  );
}

export function GraphRelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  interactionWidth,
  style,
  label,
  labelBgStyle,
  labelStyle,
  data,
  selected,
}: EdgeProps<GraphRelationshipFlowEdge>) {
  const [fallbackPath, defaultLabelX, defaultLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const path = data?.pathData ?? fallbackPath;
  const text = visibleLabel(label);
  const badges = (data?.labelBadges ?? []).filter(
    (badge): badge is GraphEdgeLabelBadge => badge === "kinship" || badge === "temporal",
  );
  const hasLabelCard = Boolean(text || badges.length);
  const labelSize =
    data?.labelSize ?? (hasLabelCard ? graphEdgeLabelSize(text ?? "", badges.length) : undefined);
  const labelX = data?.labelPlacement?.x ?? defaultLabelX;
  const labelY = data?.labelPlacement?.y ?? defaultLabelY;
  const labelPositionStyle = {
    "--graph-edge-rendered-label-bg": cssToken(labelBgStyle?.fill, "var(--graph-edge-label-bg)"),
    "--graph-edge-rendered-label-border": cssToken(
      labelBgStyle?.stroke,
      "var(--graph-edge-undirected-stroke)",
    ),
    "--graph-edge-rendered-label-text": cssToken(labelStyle?.fill, "var(--graph-edge-label-text)"),
    width: labelSize ? `${labelSize.width}px` : undefined,
    height: labelSize ? `${labelSize.height}px` : undefined,
    minWidth: labelSize ? `${labelSize.width}px` : undefined,
    minHeight: labelSize ? `${labelSize.height}px` : undefined,
    padding: 0,
    borderColor: "var(--transparent)",
    background: "var(--transparent)",
    color: "var(--graph-edge-rendered-label-text)",
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
  } as CSSProperties;
  const labelCardStyle = {
    width: labelSize ? `${labelSize.width}px` : undefined,
    height: labelSize ? `${labelSize.height}px` : undefined,
  } as CSSProperties;
  const labelClassName = `graph-edge-label nodrag nopan nowheel${data?.onLabelClick ? " is-interactive" : ""}${selected ? " is-selected" : ""}${data?.labelCollisionFallback ? " has-collision-fallback" : ""}`;
  const labelTitle = data?.labelTitle ?? text ?? undefined;
  const labelContent = (
    <span className="graph-edge-label__card" style={labelCardStyle}>
      <span className="graph-edge-label__content">
        {badges.map((badge) => (
          <span className="graph-edge-label__badge" data-edge-label-badge={badge} key={badge}>
            {badge === "kinship" ? <GitFork /> : <Clock3 />}
          </span>
        ))}
        {text && <span className="graph-edge-label__text">{text}</span>}
      </span>
    </span>
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={style}
      />
      {hasLabelCard && (
        <EdgeLabelRenderer>
          {data?.onLabelClick ? (
            <InteractiveGraphEdgeLabel
              id={id}
              className={labelClassName}
              labelTitle={labelTitle}
              labelSize={labelSize}
              positionStyle={labelPositionStyle}
              onLabelClick={data.onLabelClick}
            >
              {labelContent}
            </InteractiveGraphEdgeLabel>
          ) : (
            <div
              className={labelClassName}
              data-edge-label-id={id}
              aria-hidden="true"
              title={labelTitle}
              style={labelPositionStyle}
            >
              {labelContent}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const graphRelationshipEdgeTypes = {
  [GRAPH_RELATIONSHIP_EDGE_TYPE]: GraphRelationshipEdge,
};
