import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  MapPin,
  Pin,
  Plus,
  Star,
} from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import type { SemanticZoomTier } from "../figures/relationships";
import type { FigureNode } from "../model";
import { StoryNodeCard, StoryNodeIdentity } from "../StoryNodeCard";
import { usePlaceMapVisualClip } from "./PlaceMapFrameContext";
import type { LevelRect } from "./placeLevels";
import "./PlaceNode.css";

export type PlaceCardData = {
  place: FigureNode;
  measuring: boolean;
  measureStart: boolean;
  /** Whether anything is inside, which decides what the card offers. */
  filled: boolean;
  /** Where this place's map can be shown from, when it has one. */
  mapPreview?: string;
  onOpenLevel: (place: FigureNode) => void;
  onExpandMap: (place: FigureNode) => void;
  onPlaceDisplayChange: (place: FigureNode, display: "card" | "pin") => void;
  zoomTier: SemanticZoomTier;
  zoom: number;
  pin: boolean;
  /** The full card stays measurable while its screen-space drag pin is shown. */
  dragPreview?: boolean;
};

export type PlaceFlowNode = Node<PlaceCardData>;

export const placeNodeTypes = { place: PlaceNode };

const placeCoordinateHandleStyle = {
  top: 6,
  right: "auto",
  bottom: "auto",
  left: 6,
  transform: "translate(-50%, -50%)",
} satisfies CSSProperties;

export function PlaceNode({
  data,
  selected,
  width,
  height,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<PlaceFlowNode>) {
  const { t } = useI18n();
  const item = data.place;
  const mapVisualClip = usePlaceMapVisualClip(item.parentPlaceId);
  const nodeVisualClip = placeNodeVisualClip(mapVisualClip?.bounds, {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
    width,
    height,
  });
  const appliedVisualClip = data.dragPreview ? undefined : nodeVisualClip;
  const root = useRef<HTMLDivElement>(null);
  const pendingFocusLabel = useRef<string | null>(null);
  const previousPin = useRef(data.pin);
  const [displayTransition, setDisplayTransition] = useState<"card" | "pin" | null>(null);
  useEffect(() => {
    const label = pendingFocusLabel.current;
    if (!label) return;
    const frame = window.requestAnimationFrame(() => {
      const replacement = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
      ].find((candidate) => candidate.getAttribute("aria-label") === label);
      if (!replacement) return;
      replacement.focus();
      if (document.activeElement === replacement) pendingFocusLabel.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.pin, width, height]);
  useLayoutEffect(() => {
    if (previousPin.current === data.pin) return;
    previousPin.current = data.pin;
    setDisplayTransition(
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? null
        : data.pin
          ? "pin"
          : "card",
    );
  }, [data.pin]);
  if (data.pin) {
    const scale = 1 / Math.max(0.08, data.zoom);
    const pinPresentation =
      data.zoomTier === "detail"
        ? { font: 14, mark: 28, labelWidth: 156 }
        : data.zoomTier === "compact"
          ? { font: 12, mark: 24, labelWidth: 112 }
          : { font: 14, mark: 20, labelWidth: 116 };
    return (
      <div
        ref={root}
        className={`place-node-pin zoom-${data.zoomTier}${selected ? " is-selected" : ""}${data.measuring ? " is-measuring" : ""}${data.measureStart ? " is-measure-start" : ""}${displayTransition === "pin" ? " is-display-transition" : ""}`}
        data-place-id={item.id}
        data-zoom-tier={data.zoomTier}
        data-drag-preview={data.dragPreview ? "true" : undefined}
        data-map-clipped={appliedVisualClip ? "true" : undefined}
        onAnimationEnd={(event) => {
          if (!(event.target instanceof Element)) return;
          if (!event.target.classList.contains("place-node-pin__label")) return;
          setDisplayTransition((current) => (current === "pin" ? null : current));
        }}
        style={
          {
            ...appliedVisualClip,
            "--place-pin-font": `${pinPresentation.font * scale}px`,
            "--place-pin-control": `${28 * scale}px`,
            "--place-pin-icon": `${16 * scale}px`,
            "--place-pin-mark": `${pinPresentation.mark * scale}px`,
            "--place-pin-label-width": `${pinPresentation.labelWidth * scale}px`,
            "--place-pin-tip": `${6 * scale}px`,
            "--place-pin-gap": `${4 * scale}px`,
            "--place-pin-padding": `${6 * scale}px`,
          } as CSSProperties
        }
      >
        <Handle
          id="place-anchor"
          type="target"
          position={Position.Top}
          isConnectable={false}
          className="place-coordinate-handle place-node-pin__handle"
        />
        <Handle
          id="place-anchor"
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          className="place-coordinate-handle place-node-pin__handle"
        />
        <MapPin className="place-node-pin__mark" aria-hidden="true" />
        <span className="place-node-pin__tip" aria-hidden="true" />
        <div className="place-node-pin__label">
          <strong className="place-node-pin__name" title={item.name}>
            {item.name}
          </strong>
          {data.zoomTier !== "overview" && !data.measuring ? (
            <>
              <IconButton
                className="place-node-pin__action nodrag nopan"
                size="compact"
                appearance="ghost"
                label={t("placeShowAsCard", { name: item.name })}
                icon={<ChevronsUpDown />}
                onClick={(event) => {
                  event.stopPropagation();
                  pendingFocusLabel.current = t("placeShowAsPin", { name: item.name });
                  data.onPlaceDisplayChange(item, "card");
                }}
              />
              {data.zoomTier === "detail" ? (
                <IconButton
                  className="place-node-pin__action nodrag nopan"
                  size="compact"
                  appearance="ghost"
                  label={
                    data.filled
                      ? t("placeOpenLevel", { name: item.name })
                      : t("placeStartLevel", { name: item.name })
                  }
                  icon={data.filled ? <CornerDownRight /> : <Plus />}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onOpenLevel(item);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div
      ref={root}
      className={`place-node-shell${displayTransition === "card" ? " is-display-transition" : ""}`}
      data-drag-preview={data.dragPreview ? "true" : undefined}
      data-map-clipped={appliedVisualClip ? "true" : undefined}
      style={appliedVisualClip}
      onAnimationEnd={(event) => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.classList.contains("story-node")) return;
        setDisplayTransition((current) => (current === "card" ? null : current));
      }}
    >
      <Handle
        id="place-anchor"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <Handle
        id="place-anchor"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <StoryNodeCard
        zoomTier={data.zoomTier}
        viewportZoom={data.zoom}
        kind="ort"
        important={!!item.important}
        selected={selected}
        modifiers={[
          item.mapImageId ? "is-map" : "",
          item.pinned ? "is-pinned" : "",
          data.measuring ? "is-measuring" : "",
          data.measureStart ? "is-measure-start" : "",
        ]}
      >
        {data.mapPreview && data.zoomTier !== "overview" ? (
          // The preview is the signal: a place with a map looks different from
          // one without, without a badge or a label saying so.
          <span className="place-node__preview" aria-hidden="true">
            <img src={data.mapPreview} alt="" draggable={false} />
          </span>
        ) : null}
        <StoryNodeIdentity
          // It says what it is. A sheet you lay places onto is not one of them.
          kindLabel={item.mapImageId ? t("mapKind") : t("place")}
          name={item.name}
          leading={
            item.important ? (
              <Star className="importance-mark" aria-label={t("favoritePlaceMarker")} />
            ) : undefined
          }
          // A grey dot in the corner does not answer why the card cannot be dragged. The
          // pin that holds it does -- with the same glyph the action beside it carries, and
          // with a name for screen readers.
          trailing={
            item.pinned ? (
              <Pin className="place-node__pinned" aria-label={t("placePositionLocked")} />
            ) : undefined
          }
          // A map card carries its picture, not a description of a place: the
          // field that would edit this is not offered for a map, so showing it
          // would put text on the card that nothing can reach.
          secondary={item.mapImageId ? undefined : item.sub}
        />
        {data.zoomTier !== "overview" && !data.measuring && item.mapImageId ? (
          <IconButton
            className="place-node__enter nodrag nopan"
            size="compact"
            appearance="ghost"
            label={t("placeExpandMap", { name: item.name })}
            icon={<ChevronsUpDown />}
            onClick={(event) => {
              event.stopPropagation();
              data.onExpandMap(item);
            }}
          />
        ) : null}
        {data.zoomTier !== "overview" && !data.measuring && !item.mapImageId ? (
          <IconButton
            className="place-node__enter nodrag nopan"
            size="compact"
            appearance="ghost"
            label={t("placeShowAsPin", { name: item.name })}
            icon={<ChevronsDownUp />}
            onClick={(event) => {
              event.stopPropagation();
              pendingFocusLabel.current = t("placeShowAsCard", { name: item.name });
              data.onPlaceDisplayChange(item, "pin");
            }}
          />
        ) : null}
        {data.zoomTier !== "overview" && !data.measuring ? (
          <IconButton
            className="place-node__enter nodrag nopan"
            size="compact"
            appearance="ghost"
            label={
              data.filled
                ? t("placeOpenLevel", { name: item.name })
                : t("placeStartLevel", { name: item.name })
            }
            icon={data.filled ? <CornerDownRight /> : <Plus />}
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenLevel(item);
            }}
          />
        ) : null}
      </StoryNodeCard>
    </div>
  );
}

export function placePosition(place: FigureNode) {
  return { x: place.mapX ?? place.x, y: place.mapY ?? place.y };
}

/** Clips a node's painted overflow to its host map without changing node geometry. */
export function placeNodeVisualClip(
  visibleMap: LevelRect | undefined,
  node: Partial<LevelRect>,
): CSSProperties | undefined {
  const { x, y, width, height } = node;
  if (
    !visibleMap ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    ![visibleMap.x, visibleMap.y, visibleMap.width, visibleMap.height, x, y, width, height].every(
      Number.isFinite,
    ) ||
    !(visibleMap.width > 0) ||
    !(visibleMap.height > 0) ||
    !(width > 0) ||
    !(height > 0)
  )
    return undefined;
  const top = visibleMap.y - y || 0;
  const right = x + width - (visibleMap.x + visibleMap.width) || 0;
  const bottom = y + height - (visibleMap.y + visibleMap.height) || 0;
  const left = visibleMap.x - x || 0;
  return { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)` };
}
