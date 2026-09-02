import { Check, ChevronsDownUp, Crop, Lock, LockOpen, Minus, Plus } from "lucide-react";
import { IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
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
  adjusting,
  measured,
  onToggleAdjusting,
  onCrop,
  onToggleLock,
  onCollapse,
}: {
  map: FigureNode;
  crop: ImageCrop;
  adjusting: boolean;
  measured: string;
  onToggleAdjusting: () => void;
  onCrop: (crop: ImageCrop) => void;
  onToggleLock: () => void;
  onCollapse: () => void;
}) {
  const { t } = useI18n();
  const locked = Boolean(map.pinned);
  return (
    <div className="place-map-toolbar" role="toolbar" aria-label={t("placeMapActions")}>
      <span className="place-map-toolbar__name">{map.name}</span>
      <span className="place-map-toolbar__measure">
        {adjusting ? `${Math.round(crop.zoom * 100)} %` : measured}
      </span>
      {adjusting ? (
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
          <IconButton
            size="compact"
            appearance="ghost"
            label={t("placeCropMap", { name: map.name })}
            icon={<Crop />}
            onClick={onToggleAdjusting}
          />
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
          <IconButton
            size="compact"
            appearance="ghost"
            label={t("placeCollapseMap", { name: map.name })}
            icon={<ChevronsDownUp />}
            onClick={onCollapse}
          />
        </>
      )}
    </div>
  );
}
