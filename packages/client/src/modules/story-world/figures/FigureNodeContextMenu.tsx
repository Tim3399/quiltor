import { Link2, Star, Trash2, UserRound } from "lucide-react";
import { useEffect } from "react";
import { ContextMenu, MenuItem, MenuSeparator } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./FigureNodeContextMenu.css";

export type FigureNodeMenuState = { id: string; x: number; y: number };

export type FigureNodeContextMenuProps = {
  menu: FigureNodeMenuState | null;
  nodes: FigureNode[];
  onClose: () => void;
  onOpenInspector: (id: string) => void;
  onConnect: (id: string) => void;
  onPatch: (id: string, patch: Partial<FigureNode>) => void;
  onDelete: (id: string) => void;
};

export function FigureNodeContextMenu({
  menu,
  nodes,
  onClose,
  onOpenInspector,
  onConnect,
  onPatch,
  onDelete,
}: FigureNodeContextMenuProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!menu) return;
    document.addEventListener("pointerdown", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  const node = nodes.find((item) => item.id === menu.id);
  return (
    <div
      className="node-context-menu material-popover"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ContextMenu label={t("elementActions")} onClose={onClose}>
        <MenuItem onSelect={() => onOpenInspector(menu.id)}>
          <UserRound />
          {t("openInInspector")}
        </MenuItem>
        <MenuItem onSelect={() => onConnect(menu.id)}>
          <Link2 />
          {t("connect")}
        </MenuItem>
        <MenuItem
          onSelect={() => {
            if (node) onPatch(node.id, { important: !node.important });
            onClose();
          }}
        >
          <Star />
          {node?.important ? t("unmarkImportant") : t("markImportant")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => onDelete(menu.id)}>
          <Trash2 />
          {t("deleteElement")}
        </MenuItem>
      </ContextMenu>
    </div>
  );
}
