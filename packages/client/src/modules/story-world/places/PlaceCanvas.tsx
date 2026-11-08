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
import { PlaceGround } from "./PlaceGround";
import { PlaceLevelTrail } from "./PlaceLevelTrail";
import { type ActivePlaceMapChromeProps, PlaceMapChromeOverlay } from "./PlaceMapChromeOverlay";
import { PlaceMapFrameProvider } from "./PlaceMapFrameContext";
import { PlaceMapNode } from "./PlaceMapNode";
import { measureClickTarget } from "./placeCanvasModel";
import { PlaceMeasurePoint } from "./PlaceMeasurePoint";
import { PlaceMeasurementOverlay } from "./PlaceMeasurementOverlay";
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
  trailScale,
  onGoToLevel,
  onSelectPlace,
  onEnterPlace,
  onClearSelection,
  onMeasurePoint,
  onStopMeasuring,
  onScale,
  mapTools,
  mapChrome,
}: {
  controller: PlaceCanvasController;
  placesCount: number;
  measuring: boolean;
  measureSelection: string[];
  scale?: FigureState["mapScale"];
  trail: FigureNode[];
  /** What a hundred pixels mean here, said where the level is named. */
  trailScale: string;
  onGoToLevel: (levelId: string | undefined) => void;
  onSelectPlace: (id: string) => void;
  onEnterPlace: (id: string) => void;
  onClearSelection: () => void;
  /** A free point on the surface, in flow units; offered only while measuring. */
  onMeasurePoint?: (point: { x: number; y: number }) => void;
  onStopMeasuring: () => void;
  onScale: (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) => void;
  /** What the selected map offers, shown over the canvas rather than on the map. */
  mapTools?: ReactNode;
  mapChrome?: ActivePlaceMapChromeProps;
}) {
  const { t } = useI18n();
  const selectPlaceFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = target.closest<HTMLElement>(".react-flow__node[data-id]");
      const id = node?.dataset.id;
      if (!id || target !== node || !event.currentTarget.contains(node)) return;
      event.preventDefault();
      onSelectPlace(id);
    },
    [onSelectPlace],
  );

  const measurePointAt = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const point = controller.toFlowPosition({ x: event.clientX, y: event.clientY });
      if (point && onMeasurePoint) onMeasurePoint(point);
    },
    [controller, onMeasurePoint],
  );
  // A laid-out map and the level's picture are nodes, so a click on them never
  // reaches the pane. While measuring it is a free point there, not the map's middle.
  const measureAwareNodeClick = useCallback(
    (event: { clientX: number; clientY: number }, node: { id: string; type?: string }) => {
      if (onMeasurePoint) {
        const target = measureClickTarget(node.type ?? "", node.id);
        if (target === "none") return;
        if (target === "point") {
          measurePointAt(event);
          return;
        }
      }
      onSelectPlace(node.id);
    },
    [measurePointAt, onMeasurePoint, onSelectPlace],
  );

  const levelTrail = <PlaceLevelTrail trail={trail} scale={trailScale} onGoToLevel={onGoToLevel} />;

  return (
    <PlaceMapFrameProvider>
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
            {measuring ? null : levelTrail}
            {mapTools}
            {controller.dragPreview ? (
              <div
                className="place-drag-preview"
                data-testid="place-drag-preview"
                data-place-id={controller.dragPreview.id}
                style={{
                  left: controller.dragPreview.clientX,
                  top: controller.dragPreview.clientY,
                }}
                aria-hidden="true"
              >
                <span className="place-drag-preview__tip" />
                <MapPin className="place-drag-preview__pin" />
                <span className="place-drag-preview__name">{controller.dragPreview.name}</span>
              </div>
            ) : null}
            {mapChrome ? (
              <PlaceMapChromeOverlay
                controller={controller}
                chrome={mapChrome}
                measuring={measuring}
              />
            ) : null}
            {measuring ? (
              <PlaceMeasurementOverlay
                measureSelection={measureSelection}
                scale={scale}
                onScale={onScale}
                onStop={onStopMeasuring}
                trail={levelTrail}
              />
            ) : null}
          </>
        }
        flowProps={{
          nodeTypes: {
            ...placeNodeTypes,
            placeMap: PlaceMapNode,
            placeGround: PlaceGround,
            measurePoint: PlaceMeasurePoint,
          },
          nodesConnectable: true,
          fitViewOptions: controller.fitViewOptions,
          translateExtent: controller.translateExtent,
          onKeyDown: selectPlaceFromKeyboard,
          onInit: controller.onInit,
          onMove: (_, viewport) => controller.onMove(viewport),
          onNodeClick: measureAwareNodeClick,
          // The ordinary gesture for one level down, so a level can be reached
          // without first selecting something to find out that it has one. The
          // canvas has to give the gesture up for it: React Flow's zoom claims
          // every double click and stops it dead before it reaches a node, and on
          // a surface built out of levels going down beats zooming in.
          onNodeDoubleClick: (_, node) => onEnterPlace(node.id),
          zoomOnDoubleClick: false,
          // Beside every map, while measuring, is still somewhere a point can be set.
          onPaneClick: onMeasurePoint ? (event) => measurePointAt(event) : onClearSelection,
          onNodesChange: controller.onNodesChange,
          onNodeDragStart: (event, node) => controller.onNodeDragStart(event, node),
          onNodeDrag: (event, node) => controller.onNodeDrag(event, node),
          onNodeDragStop: (event, node) => controller.onNodeDragStop(event, node),
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
    </PlaceMapFrameProvider>
  );
}

/** Whether a minimap node stands for a place that carries a map of its own. */
function isMapCard(node: { data?: unknown }): boolean {
  return Boolean((node.data as Partial<PlaceCardData> | undefined)?.place?.mapImageId);
}
