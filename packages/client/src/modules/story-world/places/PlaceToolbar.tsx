import {
  Copy,
  Ellipsis,
  Grid3X3,
  Image,
  ImagePlus,
  Lock,
  MapPinPlus,
  Ruler,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  MenuItem,
  MenuItemCheckbox,
  MenuSeparator,
  ToolbarButton,
  UndoRedoControls,
  useCompactToolbar,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { historyShortcuts } from "../../../shared";
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
  const { t, locale } = useI18n();
  // A compact row holds at most six touch buttons (styleguide 7.4): map pictures, the toggle
  // reached for least, moves into "…" there. Undo never does.
  const compact = useCompactToolbar();
  const shortcuts = historyShortcuts(locale);
  return (
    <WorkspaceToolbar className="places-toolbar" label={t("places")}>
      <WorkspaceToolbarTitle
        title={t("places")}
        detail={
          placesCount === 1 ? t("placeMapOnePlace") : t("placeMapPlaceCount", { n: placesCount })
        }
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
            {!compact && (
              <WorkspaceToolbarGroup label={t("mapPicturesToggle")}>
                <ToolbarButton
                  label={t("mapPicturesToggle")}
                  icon={<Image />}
                  collapseAt="medium"
                  aria-pressed={picturesVisible}
                  onClick={() => onPicturesVisibleChange(!picturesVisible)}
                />
              </WorkspaceToolbarGroup>
            )}
          </>
        }
        history={
          <WorkspaceToolbarGroup label={t("placesHistory")}>
            <UndoRedoControls
              label={t("placesHistory")}
              undoLabel={t("undo")}
              redoLabel={t("redo")}
              undoShortcut={shortcuts.undo}
              redoShortcut={shortcuts.redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => onUndo?.()}
              onRedo={() => onRedo?.()}
            />
          </WorkspaceToolbarGroup>
        }
        overflow={
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
            {compact && (
              <MenuItemCheckbox
                icon={<Image />}
                label={t("mapPicturesToggle")}
                checked={picturesVisible}
                onCheckedChange={onPicturesVisibleChange}
              />
            )}
            <MenuItemCheckbox
              icon={<Grid3X3 />}
              label={t("snapToGrid")}
              checked={snapToGrid}
              onCheckedChange={onSnapToGridChange}
            />
            <MenuItemCheckbox
              icon={<Lock />}
              label={t("bindToMap")}
              disabled={!hasGround}
              checked={boundToGround}
              onCheckedChange={onBoundToGroundChange}
            />
            <MenuSeparator />
            <MenuItem
              icon={<Copy />}
              label={t("duplicatePlace")}
              disabled={!selected}
              onSelect={onDuplicate}
            />
            {/* Leaves the toolbar for the end of the detail panel in T-258 part 3. */}
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              label={t("deletePlace")}
              tone="danger"
              disabled={!selected}
              onSelect={onDelete}
            />
          </DropdownMenu>
        }
      />
    </WorkspaceToolbar>
  );
}
