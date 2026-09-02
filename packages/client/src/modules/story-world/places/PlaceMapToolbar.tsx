import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Crop,
  Lock,
  LockOpen,
  Minus,
  Plus,
  Ruler,
} from "lucide-react";
import { IconButton, Popover, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode, MapScale } from "../model";
import { useRef, useState } from "react";
import { type ImageCrop, IMAGE_ZOOM_RANGE, zoomedCrop } from "./placeImageCrop";
import "./PlaceMapToolbar.css";

/**
 * What can be done to the selected map, kept beside the canvas.
 *
 * A map is drawn at the size of the ground it stands for, so a bar pinned to its
 * own edge is off the screen exactly when the map is large enough to be worth
 * using. These controls stay where they can be reached however far the picture
 * runs, and they name the map so it is clear which one they act on.
 */
export function PlaceMapToolbar({
  map,
  crop,
  expanded,
  adjusting,
  measured,
  onToggleAdjusting,
  onCrop,
  onToggleLock,
  onCollapse,
  onExpand,
  onEnter,
  scale,
  onScale,
}: {
  map: FigureNode;
  crop: ImageCrop;
  /** Whether the map is laid out on the ground or sitting as a card. */
  expanded: boolean;
  adjusting: boolean;
  measured: string;
  onToggleAdjusting: () => void;
  onCrop: (crop: ImageCrop) => void;
  onToggleLock: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onEnter: () => void;
  /** What a hundred pixels across this map mean, when the author has said. */
  scale: MapScale | undefined;
  onScale: (patch: Partial<MapScale>) => void;
}) {
  const { t } = useI18n();
  const scaleAnchor = useRef<HTMLButtonElement>(null);
  const [scaleOpen, setScaleOpen] = useState(false);
  const locked = Boolean(map.pinned);
  return (
    <div className="place-map-toolbar" role="toolbar" aria-label={t("placeMapActions")}>
      <span className="place-map-toolbar__name">{map.name}</span>
      <span className="place-map-toolbar__measure">
        {adjusting && expanded ? `${Math.round(crop.zoom * 100)} %` : measured}
      </span>
      {/* A map carries its own scale -- a hundred pixels across a city plan and
          a hundred across the continent it stands on are not the same distance
          -- and the place to say which is beside the reading it decides. It
          describes the sheet, not the way the sheet is being shown, so it is
          reachable whether the map is laid out or sitting as a card; only while
          the picture is being adjusted does the reading mean something else. */}
      {adjusting ? null : (
        <>
          <IconButton
            ref={scaleAnchor}
            size="compact"
            appearance="ghost"
            label={t("placeMapScale", { name: map.name })}
            icon={<Ruler />}
            aria-haspopup="dialog"
            aria-expanded={scaleOpen}
            onClick={() => setScaleOpen((open) => !open)}
          />
          <Popover
            anchorRef={scaleAnchor}
            open={scaleOpen}
            onClose={() => setScaleOpen(false)}
            label={t("placeMapScale", { name: map.name })}
            compactMode="popover"
          >
            <div className="place-map-toolbar__scale">
              <TextField
                fieldClassName="place-map-toolbar__scale-value"
                label={t("scale")}
                type="number"
                min="0.01"
                step="0.01"
                value={scale?.unitsPer100px ?? 1}
                onChange={(event) => onScale({ unitsPer100px: Number(event.target.value) || 1 })}
              />
              <span className="place-map-toolbar__scale-per">{t("perHundredPx")}</span>
              <TextField
                fieldClassName="place-map-toolbar__scale-unit"
                label={t("unitLabelField")}
                value={scale?.unitLabel ?? t("unitsDefault")}
                onChange={(event) => onScale({ unitLabel: event.target.value })}
              />
            </div>
          </Popover>
        </>
      )}
      {adjusting && expanded ? (
        <>
          {/* Buttons as well as the wheel: a trackpad's wheel is easy to miss by
              a hair, and the zoom needs to be reachable without one. */}
          <IconButton
            size="compact"
            appearance="ghost"
            label={t("placeCropOut")}
            icon={<Minus />}
            disabled={crop.zoom <= IMAGE_ZOOM_RANGE.min}
            onClick={() => onCrop(zoomedCrop(crop, -1))}
          />
          <IconButton
            size="compact"
            appearance="ghost"
            label={t("placeCropIn")}
            icon={<Plus />}
            disabled={crop.zoom >= IMAGE_ZOOM_RANGE.max}
            onClick={() => onCrop(zoomedCrop(crop, 1))}
          />
          <IconButton
            size="compact"
            appearance="primary"
            label={t("placeCropDone", { name: map.name })}
            icon={<Check />}
            onClick={onToggleAdjusting}
          />
        </>
      ) : (
        <>
          {/* Nothing to crop while the map is a card: the band it wears is cut
              from the whole picture, not from the part the frame is showing. */}
          {expanded ? (
            <IconButton
              size="compact"
              appearance="ghost"
              label={t("placeCropMap", { name: map.name })}
              icon={<Crop />}
              onClick={onToggleAdjusting}
            />
          ) : null}
          {/* A map large enough to fill the view cannot be dragged in any way the
              eye can follow -- it just looks like the canvas moving. Locked, the
              gesture goes to the canvas where it belongs. */}
          <IconButton
            size="compact"
            appearance="ghost"
            label={
              locked
                ? t("placeUnlockMap", { name: map.name })
                : t("placeLockMap", { name: map.name })
            }
            icon={locked ? <Lock /> : <LockOpen />}
            onClick={onToggleLock}
          />
          {/* The way in, in the bar rather than on the sheet: entering a map is
              something an author decides to do, not a door standing open on
              every surface it happens to be lying on. */}
          <IconButton
            size="compact"
            appearance="ghost"
            label={t("placeOpenLevel", { name: map.name })}
            icon={<CornerDownRight />}
            onClick={onEnter}
          />
          <IconButton
            size="compact"
            appearance="ghost"
            label={
              expanded
                ? t("placeCollapseMap", { name: map.name })
                : t("placeExpandMap", { name: map.name })
            }
            icon={expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
            onClick={expanded ? onCollapse : onExpand}
          />
        </>
      )}
    </div>
  );
}
