import {
  Copy,
  Ellipsis,
  Grid3X3,
  Image,
  ImageOff,
  ImagePlus,
  Lock,
  LockOpen,
  MapPinPlus,
  MoreHorizontal,
  Redo2,
  Ruler,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  MenuItem,
  MenuSeparator,
  ToolbarButton,
  UndoRedoControls,
  useMediaMatch,
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
  boundToGround,
  onBoundToGroundChange,
  hasGround,
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
  boundToGround: boolean;
  onBoundToGroundChange: (bound: boolean) => void;
  hasGround: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  // Seven touch buttons need about 366 px here; below 381 px undo and redo move into a menu.
  const historyInMenu = useMediaMatch("(max-width: 380px)");
  return (
    <WorkspaceToolbar className="places-toolbar" label={t("places")}>
      <WorkspaceToolbarTitle
        title={t("places")}
        detail={t("nPlaces").replace("{n}", String(placesCount))}
      />
      <WorkspaceToolbarActions
        create={
          <>
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
          </>
        }
        view={
          <>
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
                <MenuItem
                  disabled={!hasGround}
                  icon={boundToGround ? <Lock /> : <LockOpen />}
                  label={boundToGround ? t("unbindFromMap") : t("bindToMap")}
                  onSelect={() => onBoundToGroundChange(!boundToGround)}
                />
              </DropdownMenu>
            </WorkspaceToolbarGroup>
          </>
        }
        history={
          !historyInMenu && (
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
          )
        }
        actions={
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
        }
        overflow={
          historyInMenu && (
            <DropdownMenu
              label={t("toolbarMoreActions")}
              renderTrigger={({ ref, ...triggerProps }) => (
                <ToolbarButton
                  {...triggerProps}
                  ref={ref}
                  label={t("toolbarMoreActions")}
                  labelMode="hidden"
                  icon={<Ellipsis />}
                />
              )}
            >
              <MenuItem
                icon={<Undo2 />}
                label={t("undoPlaces")}
                disabled={!canUndo}
                onSelect={() => onUndo?.()}
              />
              <MenuItem
                icon={<Redo2 />}
                label={t("redoPlaces")}
                disabled={!canRedo}
                onSelect={() => onRedo?.()}
              />
            </DropdownMenu>
          )
        }
      />
    </WorkspaceToolbar>
  );
}
