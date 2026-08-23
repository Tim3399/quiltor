import { Copy, MoreHorizontal, Plus, Redo2, Ruler, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { ToolbarButton } from "../../../design";
import { useI18n } from "../../../i18n";
import { Menu, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { Popover } from "../../../shared/ui/Popover";
import { useShortcut } from "../../../shared/ui/shortcuts";
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
  const keys = useShortcut();
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="context-bar">
      <div className="context-title">
        <strong>{t("places")}</strong>
        <span>{t("nPlaces").replace("{n}", String(placesCount))}</span>
      </div>
      <div className="tool-group">
        <ToolbarButton label={t("newPlace")} icon={<Plus />} appearance="primary" onClick={onAdd} />
      </div>
      <div className="tool-group">
        <ToolbarButton
          label={t("measureDistance")}
          appearance="ghost"
          icon={<Ruler />}
          aria-pressed={measuring}
          onClick={onMeasuringToggle}
        />
      </div>
      <div className="tool-group">
        <ToolbarButton
          label={t("undoPlaces")}
          icon={<Undo2 />}
          labelMode="hidden"
          appearance="ghost"
          size="regular"
          disabled={!canUndo}
          onClick={onUndo}
          title={`${t("undoPlaces")} · ${keys("Z")}`}
        />
        <ToolbarButton
          label={t("redoPlaces")}
          icon={<Redo2 />}
          labelMode="hidden"
          appearance="ghost"
          size="regular"
          disabled={!canRedo}
          onClick={onRedo}
          title={`${t("redoPlaces")} · ${keys("Z", { shift: true })}`}
        />
      </div>
      <div className="tool-group">
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
      </div>
    </div>
  );
}
