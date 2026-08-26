import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type MiniMapProps,
  type Node,
  ReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import type { ReactNode } from "react";
import type { SemanticZoomTier } from "./figures/relationships";

export interface StoryGraphCanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
  nodes: NodeType[];
  edges: EdgeType[];
  zoomTier: SemanticZoomTier;
  flowProps: Omit<
    ReactFlowProps<NodeType, EdgeType>,
    "nodes" | "edges" | "children" | "fitView" | "minZoom" | "maxZoom" | "deleteKeyCode"
  >;
  className?: string;
  showGrid?: boolean;
  gridSize: number;
  minimapProps?: MiniMapProps<NodeType> | false;
  overlay?: ReactNode;
  flowChildren?: ReactNode;
  children?: ReactNode;
}

/** Shared React Flow scaffold for story-world canvases. */
export function StoryGraphCanvas<NodeType extends Node, EdgeType extends Edge>({
  nodes,
  edges,
  zoomTier,
  flowProps,
  className = "",
  showGrid = true,
  gridSize,
  minimapProps = {},
  overlay,
  flowChildren,
  children,
}: StoryGraphCanvasProps<NodeType, EdgeType>) {
  return (
    <div className={`flow-area zoom-${zoomTier} ${className}`.trim()}>
      {overlay}
      <ReactFlow<NodeType, EdgeType>
        {...flowProps}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.08}
        maxZoom={2.2}
        deleteKeyCode={null}
      >
        {showGrid && zoomTier !== "overview" && (
          <Background
            className={`board-grid board-grid-${zoomTier}`}
            variant={BackgroundVariant.Lines}
            gap={gridSize}
            size={0.55}
            color="var(--line)"
          />
        )}
        {flowChildren}
        <Controls position="bottom-left" />
        {minimapProps !== false && (
          <MiniMap<NodeType>
            position="bottom-right"
            pannable
            zoomable
            maskColor="var(--minimap-mask)"
            {...minimapProps}
          />
        )}
      </ReactFlow>
      {children}
    </div>
  );
}
