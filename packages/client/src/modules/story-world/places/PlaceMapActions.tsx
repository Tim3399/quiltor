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
} from "lucide-react";
import { IconButton } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import { type ImageCrop, IMAGE_ZOOM_RANGE, zoomedCrop } from "./placeImageCrop";

export interface PlaceMapActionsProps {
  map: FigureNode;
  crop: ImageCrop;
  expanded: boolean;
  adjusting: boolean;
  onToggleAdjusting: () => void;
  onCrop: (crop: ImageCrop) => void;
  onToggleLock: () => void;
  onCollapse: () => void;
  onExpand?: () => void;
  onEnter: () => void;
}

/** The same map commands serve the collapsed card and the expanded map chrome. */
export function PlaceMapActions({
  map,
  crop,
  expanded,
  adjusting,
  onToggleAdjusting,
  onCrop,
  onToggleLock,
  onCollapse,
  onExpand,
  onEnter,
}: PlaceMapActionsProps) {
  const { t } = useI18n();
  if (adjusting && expanded) {
    return (
      <>
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
    );
  }
  return (
    <>
      {expanded ? (
        <IconButton
          size="compact"
          appearance="ghost"
          label={t("placeCropMap", { name: map.name })}
          icon={<Crop />}
          onClick={onToggleAdjusting}
        />
      ) : null}
      <IconButton
        size="compact"
        appearance="ghost"
        label={
          map.pinned
            ? t("placeUnlockMap", { name: map.name })
            : t("placeLockMap", { name: map.name })
        }
        icon={map.pinned ? <Lock /> : <LockOpen />}
        onClick={onToggleLock}
      />
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
  );
}
