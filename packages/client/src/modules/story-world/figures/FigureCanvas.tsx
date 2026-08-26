import { ConnectionMode } from "@xyflow/react";
import { Link2, Plus, UserRound } from "lucide-react";
import type { ReactNode } from "react";
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
  onOpenNodeMenu: (node: FigureFlowNode, x: number, y: number) => void;
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
          onOpenNodeMenu(node, event.clientX, event.clientY);
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
