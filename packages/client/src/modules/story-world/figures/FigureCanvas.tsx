import { ConnectionLineType, ConnectionMode, type Edge, type Node } from "@xyflow/react";
import { Link2, Plus, UserRound } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState } from "../../../design";
import { useI18n } from "../../../i18n";
import { useLatest } from "../../../shared/hooks/useLatest";
import { graphRelationshipEdgeTypes, positionGraphRelationshipEdgeLabels } from "../../graph";
import { ModeBanner } from "../ModeBanner";
import { StoryGraphCanvas } from "../StoryGraphCanvas";
import {
  type FigureCardData,
  type FigureFlowNode,
  FigureMiniMapNode,
  figureNodeTypes,
  minimapColorForKind,
} from "./FigureNode";
import { GRID_SIZE } from "./relationships";
import type { FigureCanvasController } from "./useFigureCanvas";
import "./FigureCanvas.css";

export type FigureCanvasProps = {
  controller: FigureCanvasController;
  connecting: boolean;
  playing: boolean;
  onCancelConnecting: () => void;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onOpenNodeMenu: (
    node: FigureFlowNode,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) => void;
  onClearSelection: () => void;
  edgeInspector?: ReactNode;
  children?: ReactNode;
};

/**
 * What of a node the label placement reads: where it is, how large, and the guest line that
 * makes it taller. Selection, zoom tier and the rest of `data` do not move a label.
 */
function labelGeometryKey(nodes: readonly FigureFlowNode[]): string {
  return nodes
    .map(
      (node) =>
        `${node.id}:${node.position.x},${node.position.y},${node.measured?.width ?? node.width ?? ""},${node.measured?.height ?? node.height ?? ""},${node.data.guests.length},${node.dragging ? 1 : 0}`,
    )
    .join(";");
}

/**
 * Edge labels for the figure board. The full collision pass runs when the geometry settles;
 * while cards are dragged only the labels of edges at those cards are placed again, around
 * the others, which keep the places of the last full pass.
 */
export function useFigureEdgeLabels(
  nodes: FigureFlowNode[],
  edges: Edge[],
  onSelectEdge: (id: string) => void,
): Edge[] {
  const geometry = labelGeometryKey(nodes);
  const dragging = nodes.some((node) => node.dragging);
  // The full pass, only while nothing is dragged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `geometry` stands for the parts of `nodes` the placement reads.
  const full = useMemo(
    () =>
      dragging
        ? null
        : positionGraphRelationshipEdgeLabels(nodes, edges, { onLabelClick: onSelectEdge }),
    [geometry, edges, onSelectEdge, dragging],
  );
  // The last full pass, kept for the frames of the next drag. Adjusted during render, the
  // way React describes for state derived from props: one extra render when a pass
  // settles, none per frame of a drag.
  const [settled, setSettled] = useState<{
    edges: Edge[];
    onSelectEdge: unknown;
    positioned: Edge[];
  } | null>(null);
  if (full && settled?.positioned !== full) {
    setSettled({ edges, onSelectEdge, positioned: full });
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `geometry` stands for the parts of `nodes` the placement reads.
  const partial = useMemo(() => {
    if (!dragging) return null;
    const movedNodeIds = new Set(nodes.filter((node) => node.dragging).map((node) => node.id));
    const keep =
      settled && settled.edges === edges && settled.onSelectEdge === onSelectEdge
        ? { positioned: settled.positioned, movedNodeIds }
        : undefined;
    return positionGraphRelationshipEdgeLabels(nodes, edges, { onLabelClick: onSelectEdge, keep });
  }, [geometry, edges, onSelectEdge, dragging, settled]);
  return full ?? partial ?? edges;
}

// Module constants, not literals in render: React Flow keeps both in its store, and every edge
// and every minimap node renders again when one of them is new (T-372).
const DEFAULT_EDGE_OPTIONS = { type: "smoothstep" } as const;
function figureMinimapColor(node: Node): string {
  return minimapColorForKind((node.data as FigureCardData).figure.type);
}

export function FigureCanvas({
  controller,
  connecting,
  playing,
  onCancelConnecting,
  onSelectNode,
  onSelectEdge,
  onOpenNodeMenu,
  onClearSelection,
  edgeInspector,
  children,
}: FigureCanvasProps) {
  const { t } = useI18n();
  const { nodes, edges, zoomTier } = controller;
  const positionedEdges = useFigureEdgeLabels(nodes, edges, onSelectEdge);
  // Read only, by onEdgeClick below.
  const onSelectEdgeRef = useLatest(onSelectEdge);
  // Stable: React Flow hands it to every edge, and a new one rendered all of them again on
  // every zoom step (T-372).
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    if ((edge.data as { kind?: string } | undefined)?.kind !== "relationship") return;
    onSelectEdgeRef.current(edge.id);
  }, []);
  const nodesRef = useLatest(nodes);
  const pendingTouch = useRef<{
    timer: number;
    trigger: HTMLElement;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const figureNodeElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const element = target.closest<HTMLElement>(".react-flow__node[data-id]");
      return element?.closest(".figure-workspace") ? element : null;
    };
    const openFromElement = (element: HTMLElement, x?: number, y?: number) => {
      const node = nodesRef.current.find((candidate) => candidate.id === element.dataset.id);
      if (!node) return false;
      const box = element.getBoundingClientRect();
      onOpenNodeMenu(
        node,
        x && x > 0 ? x : box.left + box.width / 2,
        y && y > 0 ? y : box.top + box.height / 2,
        element,
      );
      return true;
    };
    const clearTouch = () => {
      if (pendingTouch.current) window.clearTimeout(pendingTouch.current.timer);
      pendingTouch.current = null;
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const element = figureNodeElement(event.target);
      if (!element || !openFromElement(element)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".react-flow__handle, button, input, select, textarea, a[href]")
      ) {
        return;
      }
      const element = figureNodeElement(target);
      if (!element?.dataset.id) return;
      clearTouch();
      const candidate = {
        timer: 0,
        trigger: element,
        x: event.clientX,
        y: event.clientY,
      };
      candidate.timer = window.setTimeout(() => {
        if (pendingTouch.current !== candidate) return;
        pendingTouch.current = null;
        openFromElement(candidate.trigger, candidate.x, candidate.y);
      }, 550);
      pendingTouch.current = candidate;
    };
    const pointermove = (event: PointerEvent) => {
      const pending = pendingTouch.current;
      if (
        pending &&
        (Math.abs(event.clientX - pending.x) > 10 || Math.abs(event.clientY - pending.y) > 10)
      ) {
        clearTouch();
      }
    };

    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown, true);
    document.addEventListener("pointermove", pointermove, true);
    document.addEventListener("pointerup", clearTouch, true);
    document.addEventListener("pointercancel", clearTouch, true);
    return () => {
      clearTouch();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown, true);
      document.removeEventListener("pointermove", pointermove, true);
      document.removeEventListener("pointerup", clearTouch, true);
      document.removeEventListener("pointercancel", clearTouch, true);
    };
    // The nodes are read through a ref: depending on them tore the five document listeners
    // down and put them up again on every pointer move of a drag.
  }, [onOpenNodeMenu]);

  return (
    <StoryGraphCanvas
      nodes={nodes}
      edges={positionedEdges}
      zoomTier={zoomTier}
      nodeZoom={nodeZoom}
      className={`graph-edge-surface ${edgeInspector ? "has-edge-inspector" : ""} ${connecting ? "is-connecting" : ""} ${playing ? "timeline-playing" : ""}`}
      showGrid={controller.snapToGrid}
      gridSize={GRID_SIZE}
      overlay={
        connecting ? (
          <ModeBanner icon={<Link2 />} dismissLabel={t("cancel")} onDismiss={onCancelConnecting}>
            {t("connectModeHint")}
          </ModeBanner>
        ) : null
      }
      flowProps={{
        nodeTypes: figureNodeTypes,
        edgeTypes: graphRelationshipEdgeTypes,
        connectionMode: ConnectionMode.Loose,
        connectionLineType: ConnectionLineType.SmoothStep,
        defaultEdgeOptions: DEFAULT_EDGE_OPTIONS,
        onInit: controller.onInit,
        onMove: (_, viewport) => controller.onMove(viewport),
        onNodeClick: (_, node: FigureFlowNode) => onSelectNode(node.id),
        onEdgeClick,
        onNodeContextMenu: (event, node) => {
          event.preventDefault();
          const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
          const box = trigger?.getBoundingClientRect();
          onOpenNodeMenu(
            node,
            event.clientX || (box ? box.left + box.width / 2 : 12),
            event.clientY || (box ? box.top + box.height / 2 : 12),
            trigger,
          );
        },
        onPaneClick: onClearSelection,
        onNodesChange: controller.onNodesChange,
        onNodeDragStop: (_, node) => controller.onNodeDragStop(node),
        onConnect: controller.onConnect,
        // Direct handle drags should work without first entering the assisted
        // connection mode. The mode still reveals every handle and its guidance.
        nodesConnectable: true,
        snapToGrid: controller.snapToGrid && !controller.gridOverride,
        snapGrid: [GRID_SIZE, GRID_SIZE],
      }}
      minimapProps={{
        nodeComponent: FigureMiniMapNode,
        nodeColor: figureMinimapColor,
      }}
      flowChildren={edgeInspector}
    >
      {!nodes.length && (
        <EmptyState
          className="figure-empty-state"
          aria-label={t("createElementMenu")}
          icon={<UserRound className="figure-empty-icon" />}
          title={t("createElementMenu")}
          actions={
            <Button
              appearance="primary"
              icon={<Plus />}
              onClick={() => controller.addNode("person")}
            >
              {t("newFigureName")}
            </Button>
          }
        >
          <p className="figure-empty-copy">{t("noFiguresOrAnimalsYet")}</p>
        </EmptyState>
      )}
      {children}
    </StoryGraphCanvas>
  );
}
