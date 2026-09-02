import {
  Background,
  BackgroundVariant,
  type Edge,
  type MiniMapProps,
  type Node,
  ReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  /**
   * How far out the view may go, when something limits it.
   *
   * React Flow's translateExtent holds panning inside a rectangle and says
   * nothing about scale, so a surface bounded to a picture could still be
   * zoomed out until the picture floated in the middle of empty canvas -- the
   * boundary held and looked like it did not. A floor under the zoom is what
   * makes the promise visible.
   */
  minZoom?: number;
  /** Told how large the drawing surface is, whenever that changes. */
  onSurfaceResize?: (size: { width: number; height: number }) => void;
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
  minZoom = 0.08,
  onSurfaceResize,
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
  const surface = useRef<HTMLDivElement>(null);
  const reportSurface = useRef(onSurfaceResize);
  reportSurface.current = onSurfaceResize;

  useEffect(() => {
    const element = surface.current;
    // A test renderer has no ResizeObserver, and a surface whose size was never
    // reported simply has no zoom floor -- the canvas behaves as it always did.
    if (!element || !reportSurface.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      reportSurface.current?.({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={surface}
      className={`flow-area graph-viewport-surface zoom-${zoomTier} ${hasVisibleMinimap ? "has-minimap" : ""} ${className}`.trim()}
    >
      {overlay}
      <ReactFlow<NodeType, EdgeType>
        {...flowProps}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={minZoom}
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
