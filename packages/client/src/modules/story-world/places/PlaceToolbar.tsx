import { Copy, MoreHorizontal, Plus, Ruler, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  ToolbarButton,
  UndoRedoControls,
  WorkspaceToolbar,
  WorkspaceToolbarActions,
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
  onMeasuringToggle,
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
  onMeasuringToggle: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  return (
    <WorkspaceToolbar className="places-toolbar" label={t("places")}>
      <WorkspaceToolbarTitle
        title={t("places")}
        detail={t("nPlaces").replace("{n}", String(placesCount))}
      />
      <WorkspaceToolbarActions>
        <WorkspaceToolbarGroup label={t("newPlace")}>
          <ToolbarButton
            label={t("newPlace")}
            icon={<Plus />}
            appearance="primary"
            onClick={onAdd}
          />
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
          <ToolbarButton
            ref={actionsButton}
            label={t("placeActions")}
            icon={<MoreHorizontal />}
            labelMode="hidden"
            appearance="ghost"
            size="regular"
            disabled={!selected}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((value) => !value)}
          />
          <Popover
            anchorRef={actionsButton}
            open={actionsOpen}
            onClose={() => setActionsOpen(false)}
            label={t("placeActions")}
          >
            <Menu label={t("placeActions")} onClose={() => setActionsOpen(false)}>
              <MenuItem
                onSelect={() => {
                  onDuplicate();
                  setActionsOpen(false);
                }}
              >
                <Copy />
                {t("duplicatePlace")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  onDelete();
                  setActionsOpen(false);
                }}
              >
                <Trash2 />
                {t("deletePlace")}
              </MenuItem>
            </Menu>
          </Popover>
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}
