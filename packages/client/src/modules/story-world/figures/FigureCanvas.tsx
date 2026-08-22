import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { Link2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../i18n";
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
    <div
      className={`flow-area zoom-${zoomTier} ${connecting ? "is-connecting" : ""} ${playing ? "timeline-playing" : ""}`}
    >
      {connecting && (
        <div className="mode-banner" role="status">
          <Link2 />
          <span>{t("connectModeHint")}</span>
          <button type="button" onClick={onCancelConnecting}>
            <X />
            <span className="sr-only">{t("cancel")}</span>
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={figureNodeTypes}
        connectionMode={ConnectionMode.Loose}
        onInit={controller.onInit}
        onMove={(_, viewport) => controller.onMove(viewport)}
        onNodeClick={(_, node: FigureFlowNode) => onSelectNode(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          onOpenNodeMenu(node, event.clientX, event.clientY);
        }}
        onPaneClick={onClearSelection}
        onNodesChange={controller.onNodesChange}
        onNodeDragStop={(_, node) => controller.onNodeDragStop(node)}
        onConnect={controller.onConnect}
        nodesConnectable={connecting}
        snapToGrid={controller.snapToGrid && !controller.gridOverride}
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        fitView
        minZoom={0.08}
        maxZoom={2.2}
        deleteKeyCode={null}
      >
        {controller.snapToGrid && zoomTier !== "overview" && (
          <Background
            className={`board-grid board-grid-${zoomTier}`}
            variant={BackgroundVariant.Lines}
            gap={GRID_SIZE}
            size={0.55}
            color="var(--line)"
          />
        )}
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeComponent={FigureMiniMapNode}
          nodeColor={(node) => minimapColorForKind((node.data as FigureCardData).figure.type)}
          maskColor="var(--minimap-mask)"
        />
      </ReactFlow>
      {children}
    </div>
  );
}
