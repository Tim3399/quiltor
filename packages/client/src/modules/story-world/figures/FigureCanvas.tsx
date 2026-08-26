import { ConnectionMode } from "@xyflow/react";
import { Link2, Plus, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button, EmptyState } from "../../../design";
import { useI18n } from "../../../i18n";
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
  onOpenNodeMenu: (
    node: FigureFlowNode,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) => void;
  onClearSelection: () => void;
  children?: ReactNode;
};

export function FigureCanvas({
  controller,
  connecting,
  playing,
  onCancelConnecting,
  onSelectNode,
  onOpenNodeMenu,
  onClearSelection,
  children,
}: FigureCanvasProps) {
  const { t } = useI18n();
  const { nodes, edges, zoomTier } = controller;
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
      const node = nodes.find((candidate) => candidate.id === element.dataset.id);
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
  }, [nodes, onOpenNodeMenu]);

  return (
    <StoryGraphCanvas
      nodes={nodes}
      edges={edges}
      zoomTier={zoomTier}
      className={`${children ? "has-timeline" : ""} ${connecting ? "is-connecting" : ""} ${playing ? "timeline-playing" : ""}`}
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
        connectionMode: ConnectionMode.Loose,
        onInit: controller.onInit,
        onMove: (_, viewport) => controller.onMove(viewport),
        onNodeClick: (_, node: FigureFlowNode) => onSelectNode(node.id),
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
        nodesConnectable: connecting,
        snapToGrid: controller.snapToGrid && !controller.gridOverride,
        snapGrid: [GRID_SIZE, GRID_SIZE],
      }}
      minimapProps={{
        nodeComponent: FigureMiniMapNode,
        nodeColor: (node) => minimapColorForKind((node.data as FigureCardData).figure.type),
      }}
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
