import type { Edge } from "@xyflow/react";
import { MapPin } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback } from "react";
import { EmptyState } from "../../../design";
import { useI18n } from "../../../i18n";
import { cardKindColor } from "../../graph";
import { GRID_SIZE } from "../figures/relationships";
import type { FigureNode, FigureState } from "../model";
import { StoryGraphCanvas } from "../StoryGraphCanvas";
import { PlaceLevelTrail } from "./PlaceLevelTrail";
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
  trail,
  onGoToLevel,
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
  trail: FigureNode[];
  onGoToLevel: (levelId: string | undefined) => void;
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
    <StoryGraphCanvas
      nodes={controller.nodes}
      edges={controller.edges as Edge[]}
      zoomTier={controller.zoomTier}
      className={`places-flow-area ${measuring ? "is-connecting" : ""}`}
      gridSize={GRID_SIZE}
      overlay={
        <>
          <PlaceLevelTrail trail={trail} onGoToLevel={onGoToLevel} />
          {measuring ? (
            <PlaceMeasurementOverlay
              measureSelection={measureSelection}
              scale={scale}
              onScale={onScale}
              onStop={onStopMeasuring}
            />
          ) : null}
        </>
      }
      flowProps={{
        nodeTypes: placeNodeTypes,
        nodesConnectable: true,
        onKeyDown: selectPlaceFromKeyboard,
        onInit: controller.onInit,
        onMove: (_, viewport) => controller.onMove(viewport),
        onNodeClick: (_, node) => onSelectPlace(node.id),
        onPaneClick: onClearSelection,
        onNodesChange: controller.onNodesChange,
        onNodeDragStop: (_, node) => controller.onNodeDragStop(node),
      }}
      minimapProps={{ nodeColor: () => cardKindColor("ort") }}
    >
      {!placesCount && (
        <EmptyState
          className="places-manager-empty"
          icon={<MapPin className="places-empty-icon" />}
          title={t("noPlacesYet")}
        >
          <p>{t("noPlacesYetBody")}</p>
        </EmptyState>
      )}
    </StoryGraphCanvas>
  );
}
