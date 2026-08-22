import { Copy, MoreHorizontal, Plus, Redo2, Ruler, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
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
        <button type="button" className="primary" onClick={onAdd}>
          <Plus />
          {t("newPlace")}
        </button>
      </div>
      <div className="tool-group">
        <button
          type="button"
          aria-pressed={measuring}
          className={measuring ? "active" : ""}
          onClick={onMeasuringToggle}
        >
          <Ruler />
          {t("measureDistance")}
        </button>
      </div>
      <div className="tool-group">
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label={t("undoPlaces")}
          title={`${t("undoPlaces")} · ${keys("Z")}`}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label={t("redoPlaces")}
          title={`${t("redoPlaces")} · ${keys("Z", { shift: true })}`}
        >
          <Redo2 />
        </button>
      </div>
      <div className="tool-group">
        <button
          type="button"
          ref={actionsButton}
          disabled={!selected}
          aria-label={t("placeActions")}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          <MoreHorizontal />
        </button>
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
