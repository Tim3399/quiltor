import {
  Background,
  BackgroundVariant,
  type Edge,
  type MiniMapProps,
  type Node,
  ReactFlow,
  type ReactFlowProps,
  useStoreApi,
} from "@xyflow/react";
import {
  type DOMAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLatest } from "../../shared/hooks/useLatest";
import { GraphViewportChrome, useArrangementLock } from "../graph";
import { type SemanticZoomTier, semanticZoomTier } from "./figures/relationships";
import { storyNodeZoomStyle } from "./StoryNodeCard";

export interface StoryGraphCanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
  nodes: NodeType[];
  edges: EdgeType[];
  zoomTier: SemanticZoomTier;
  /**
   * The surface carries the cards' zoom variables and the cards inherit them. They are
   * written straight from React Flow's store, so a zoom step renders nothing at all.
   */
  nodeZoomVariables?: boolean;
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
  /** Listeners on the surface itself, for a gesture that belongs to the whole canvas. */
  surfaceListeners?: Pick<
    DOMAttributes<HTMLDivElement>,
    | "onPointerDownCapture"
    | "onPointerMoveCapture"
    | "onPointerUpCapture"
    | "onPointerCancelCapture"
    | "onClickCapture"
  >;
}

/**
 * Writes the cards' zoom variables onto the surface whenever the viewport zooms, without a
 * render (T-372). The values are the ones the board's own state used to hand each card: the
 * zoom as React Flow reports it when the board opens, rounded to hundredths on every move,
 * and 1 in the detail tier, where a card does not read them.
 */
const INITIAL_ZOOM_VARIABLES = storyNodeZoomStyle("detail", 1);

function SurfaceZoomVariables({ surface }: { surface: RefObject<HTMLDivElement | null> }) {
  const store = useStoreApi();
  // Passive, not a layout effect: a child's layout effect runs before its parent's ref is set,
  // so the surface would not be there yet on the first commit. Until then the surface holds
  // the detail values below, as the board's state did before React Flow's onInit.
  useEffect(() => {
    const write = (zoom: number) => {
      const element = surface.current;
      if (!element) return;
      const tier = semanticZoomTier(zoom);
      const style = storyNodeZoomStyle(tier, tier === "detail" ? 1 : zoom);
      for (const [name, value] of Object.entries(style))
        element.style.setProperty(name, String(value));
    };
    let zoom = store.getState().transform[2];
    write(zoom);
    return store.subscribe((state) => {
      if (state.transform[2] === zoom) return;
      zoom = state.transform[2];
      write(Math.round(zoom * 100) / 100);
    });
  }, [store, surface]);
  return null;
}

/** Shared React Flow scaffold for story-world canvases. */
export function StoryGraphCanvas<NodeType extends Node, EdgeType extends Edge>({
  nodes,
  edges,
  zoomTier,
  nodeZoomVariables = false,
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
  surfaceListeners,
}: StoryGraphCanvasProps<NodeType, EdgeType>) {
  const [minimapVisible, setMinimapVisible] = useState(true);
  const { interactive, setInteractive, arrangementProps } = useArrangementLock();
  const hasVisibleMinimap = minimapProps !== false && minimapVisible;
  const surface = useRef<HTMLDivElement>(null);
  // Read only, by the ResizeObserver below.
  const reportSurfaceRef = useLatest(onSurfaceResize);

  useEffect(() => {
    const element = surface.current;
    // A test renderer has no ResizeObserver, and a surface whose size was never
    // reported simply has no zoom floor -- the canvas behaves as it always did.
    if (!element || !reportSurfaceRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      reportSurfaceRef.current?.({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      {...surfaceListeners}
      ref={surface}
      style={nodeZoomVariables ? INITIAL_ZOOM_VARIABLES : undefined}
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
        {...arrangementProps(flowProps)}
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
        {nodeZoomVariables && <SurfaceZoomVariables surface={surface} />}
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
