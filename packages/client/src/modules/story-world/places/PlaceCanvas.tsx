import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import { MapPin } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback } from "react";
import { useI18n } from "../../../i18n";
import { GRID_SIZE } from "../figures/relationships";
import type { FigureState } from "../model";
import { PlaceMeasurementOverlay } from "./PlaceMeasurementOverlay";
import { placeNodeTypes } from "./PlaceNode";
import type { PlaceCanvasController } from "./usePlaceCanvas";
import "./PlaceCanvas.css";

export function PlaceCanvas({
  controller,
  placesCount,
  measuring,
  measureSelection,
  scale,
  onSelectPlace,
  onClearSelection,
  onStopMeasuring,
  onScale,
}: {
  controller: PlaceCanvasController;
  placesCount: number;
  measuring: boolean;
  measureSelection: string[];
  scale?: FigureState["mapScale"];
  onSelectPlace: (id: string) => void;
  onClearSelection: () => void;
  onStopMeasuring: () => void;
  onScale: (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) => void;
}) {
  const { t } = useI18n();
  const selectPlaceFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = target.closest<HTMLElement>(".react-flow__node[data-id]");
      const id = node?.dataset.id;
      if (!id || !event.currentTarget.contains(node)) return;
      event.preventDefault();
      onSelectPlace(id);
    },
    [onSelectPlace],
  );

  return (
    <div
      className={`flow-area places-flow-area zoom-${controller.zoomTier} ${measuring ? "is-connecting" : ""}`}
    >
      {measuring && (
        <PlaceMeasurementOverlay
          measureSelection={measureSelection}
          scale={scale}
          onScale={onScale}
          onStop={onStopMeasuring}
        />
      )}
      <ReactFlow
        nodes={controller.nodes}
        edges={controller.edges}
        nodeTypes={placeNodeTypes}
        nodesConnectable
        onKeyDown={selectPlaceFromKeyboard}
        onInit={controller.onInit}
        onMove={(_, viewport) => controller.onMove(viewport)}
        onNodeClick={(_, node) => onSelectPlace(node.id)}
        onPaneClick={onClearSelection}
        onNodesChange={controller.onNodesChange}
        onNodeDragStop={(_, node) => controller.onNodeDragStop(node)}
        fitView
        minZoom={0.08}
        maxZoom={2.2}
        deleteKeyCode={null}
      >
        {controller.zoomTier !== "overview" && (
          <Background
            className={`board-grid board-grid-${controller.zoomTier}`}
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
          nodeColor={() => "var(--minimap-place)"}
          maskColor="var(--minimap-mask)"
        />
      </ReactFlow>
      {!placesCount && (
        <div className="places-manager-empty">
          <MapPin />
          <h2>{t("noPlacesYet")}</h2>
          <p>{t("noPlacesYetBody")}</p>
        </div>
      )}
    </div>
  );
}
