import type { Edge } from "@xyflow/react";
import { MapPin } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCallback } from "react";
import { EmptyState } from "../../../design";
import { useI18n } from "../../../i18n";
import { cardKindColor } from "../../graph";
import { GRID_SIZE } from "../figures/relationships";
import type { FigureNode, FigureState } from "../model";
import { StoryGraphCanvas } from "../StoryGraphCanvas";
import { PlaceLevelTrail } from "./PlaceLevelTrail";
import { PlaceMeasurementOverlay } from "./PlaceMeasurementOverlay";
import { PlaceGround } from "./PlaceGround";
import { PlaceMapNode } from "./PlaceMapNode";
import { type PlaceCardData, type PlaceFlowNode, placeNodeTypes } from "./PlaceNode";
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
  mapTools,
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
  /** What the selected map offers, shown over the canvas rather than on the map. */
  mapTools?: ReactNode;
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
      nodes={controller.nodes as PlaceFlowNode[]}
      edges={controller.edges as Edge[]}
      zoomTier={controller.zoomTier}
      className={`places-flow-area ${measuring ? "is-connecting" : ""} ${
        controller.hasGround && controller.boundToGround ? "is-bound-to-ground" : ""
      }`}
      gridSize={GRID_SIZE}
      showGrid={controller.snapToGrid}
      minZoom={controller.minZoom}
      onSurfaceResize={controller.onSurfaceResize}
      overlay={
        <>
          <PlaceLevelTrail trail={trail} onGoToLevel={onGoToLevel} />
          {mapTools}
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
        nodeTypes: { ...placeNodeTypes, placeMap: PlaceMapNode, placeGround: PlaceGround },
        nodesConnectable: true,
        fitViewOptions: controller.fitViewOptions,
        translateExtent: controller.translateExtent,
        onKeyDown: selectPlaceFromKeyboard,
        onInit: controller.onInit,
        onMove: (_, viewport) => controller.onMove(viewport),
        onNodeClick: (_, node) => onSelectPlace(node.id),
        onPaneClick: onClearSelection,
        onNodesChange: controller.onNodesChange,
        onNodeDragStop: (_, node) => controller.onNodeDragStop(node),
      }}
      minimapProps={{
        // A laid-out map is the ground, and everything worth finding in the
        // minimap is standing on it. Drawn at full strength it would swallow
        // the very pins the minimap exists to show, so it recedes to a wash.
        nodeColor: (node) => {
          // Held to the ground, the minimap's frame and the sheet are the same
          // rectangle: drawing the sheet inside it says nothing and covers the
          // things the minimap exists to show.
          if (node.type === "placeGround")
            return controller.boundToGround ? "var(--transparent)" : cardKindColor("storyboard");
          if (node.type === "placeMap")
            return `color-mix(in srgb, ${cardKindColor("storyboard")} 18%, transparent)`;
          // Collapsed maps keep their own hue down here as well, so the minimap
          // reads as the surface does rather than as one undifferentiated green.
          return isMapCard(node) ? cardKindColor("storyboard") : cardKindColor("ort");
        },
        nodeStrokeWidth: 0,
      }}
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

/** Whether a minimap node stands for a place that carries a map of its own. */
function isMapCard(node: { data?: unknown }): boolean {
  return Boolean((node.data as Partial<PlaceCardData> | undefined)?.place?.mapImageId);
}
