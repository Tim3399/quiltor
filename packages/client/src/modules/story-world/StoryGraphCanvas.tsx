import {
  Background,
  BackgroundVariant,
  type Edge,
  type MiniMapProps,
  type Node,
  ReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import { type ReactNode, useState } from "react";
import { GraphViewportChrome } from "../graph";
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
  const [minimapVisible, setMinimapVisible] = useState(true);
  /**
   * Whether the surface may be rearranged, held here rather than in React Flow.
   *
   * Its dock has a lock, and its node renderer reads `nodesDraggable` from the
   * props it was rendered with rather than from the store the lock writes to.
   * So the lock could take away selecting and connecting and left dragging
   * exactly as it was -- everything still moved under a closed padlock. Holding
   * the state here and passing it down is what makes the button mean something.
   */
  const [interactive, setInteractive] = useState(true);
  const hasVisibleMinimap = minimapProps !== false && minimapVisible;

  return (
    <div
      className={`flow-area graph-viewport-surface zoom-${zoomTier} ${hasVisibleMinimap ? "has-minimap" : ""} ${className}`.trim()}
    >
      {overlay}
      <ReactFlow<NodeType, EdgeType>
        {...flowProps}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.08}
        maxZoom={2.2}
        deleteKeyCode={null}
        nodesDraggable={interactive}
        nodesConnectable={interactive && (flowProps.nodesConnectable ?? true)}
        elementsSelectable={interactive && (flowProps.elementsSelectable ?? true)}
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
        <GraphViewportChrome<NodeType>
          fitViewOptions={flowProps.fitViewOptions}
          minimapProps={minimapProps}
          minimapVisible={minimapVisible}
          onMinimapVisibleChange={setMinimapVisible}
          interactive={interactive}
          onInteractiveChange={setInteractive}
        />
      </ReactFlow>
      {children}
    </div>
  );
}
