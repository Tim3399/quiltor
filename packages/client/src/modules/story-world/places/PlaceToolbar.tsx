import {
  Copy,
  Grid3X3,
  Image,
  ImageOff,
  ImagePlus,
  MapPinPlus,
  MoreHorizontal,
  Ruler,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  MenuItem,
  MenuSeparator,
  ToolbarButton,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";

export function PlaceToolbar({
  placesCount,
  selected,
  measuring,
  canUndo,
  canRedo,
  onAdd,
  onAddMap,
  onMeasuringToggle,
  snapToGrid,
  onSnapToGridChange,
  picturesVisible,
  onPicturesVisibleChange,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
}: {
  placesCount: number;
  selected: FigureNode | null;
  measuring: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAdd: () => void;
  onAddMap: () => void;
  onMeasuringToggle: () => void;
  snapToGrid: boolean;
  onSnapToGridChange: (snap: boolean) => void;
  picturesVisible: boolean;
  onPicturesVisibleChange: (visible: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <WorkspaceToolbar className="places-toolbar" label={t("places")}>
      <WorkspaceToolbarTitle
        title={t("places")}
        detail={t("nPlaces").replace("{n}", String(placesCount))}
      />
      <WorkspaceToolbarActions>
        <WorkspaceToolbarGroup label={t("newPlace")}>
          {/* Both actions create; the addon on the plus says what. */}
          <WorkspaceToolbarCreateButton
            label={t("newPlace")}
            icon={<MapPinPlus />}
            onClick={onAdd}
          />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label={t("newMap")}>
          <ToolbarButton label={t("newMap")} icon={<ImagePlus />} onClick={onAddMap} />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label={t("measureDistance")}>
          <ToolbarButton
            label={t("measureDistance")}
            appearance="ghost"
            icon={<Ruler />}
            aria-pressed={measuring}
            onClick={onMeasuringToggle}
          />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label={t("placeViewMenu")}>
          <DropdownMenu
            label={t("placeViewMenu")}
            renderTrigger={({ ref, ...triggerProps }) => (
              <ToolbarButton
                ref={ref}
                {...triggerProps}
                label={t("placeViewMenu")}
                icon={<Grid3X3 />}
              />
            )}
          >
            <MenuItem
              icon={<Grid3X3 />}
              label={snapToGrid ? t("hideGrid") : t("showGrid")}
              onSelect={() => onSnapToGridChange(!snapToGrid)}
            />
            <MenuItem
              icon={picturesVisible ? <ImageOff /> : <Image />}
              label={picturesVisible ? t("hideMapPictures") : t("showMapPictures")}
              onSelect={() => onPicturesVisibleChange(!picturesVisible)}
            />
          </DropdownMenu>
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label={`${t("undoPlaces")} / ${t("redoPlaces")}`}>
          <UndoRedoControls
            label={`${t("undoPlaces")} / ${t("redoPlaces")}`}
            undoLabel={t("undoPlaces")}
            redoLabel={t("redoPlaces")}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => onUndo?.()}
            onRedo={() => onRedo?.()}
          />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label={t("placeActions")}>
          <DropdownMenu
            label={t("placeActions")}
            renderTrigger={({ ref, ...triggerProps }) => (
              <ToolbarButton
                {...triggerProps}
                ref={ref}
                label={t("placeActions")}
                icon={<MoreHorizontal />}
                labelMode="hidden"
                appearance="ghost"
                size="regular"
                disabled={!selected}
              />
            )}
          >
            <MenuItem icon={<Copy />} label={t("duplicatePlace")} onSelect={onDuplicate} />
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              label={t("deletePlace")}
              tone="danger"
              onSelect={onDelete}
            />
          </DropdownMenu>
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}
