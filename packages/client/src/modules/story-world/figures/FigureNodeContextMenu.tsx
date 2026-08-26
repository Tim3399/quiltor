import { Link2, Star, Trash2, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContextMenu, MenuItem, MenuSeparator } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./FigureNodeContextMenu.css";

export type FigureNodeMenuState = {
  id: string;
  x: number;
  y: number;
  trigger?: HTMLElement | null;
};

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
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const margin = 12;
    const box = panel.current.getBoundingClientRect();
    const maximumLeft = Math.max(margin, window.innerWidth - box.width - margin);
    const maximumTop = Math.max(margin, window.innerHeight - box.height - margin);
    setPosition({
      left: Math.max(margin, Math.min(menu.x, maximumLeft)),
      top: Math.max(margin, Math.min(menu.y, maximumTop)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const trigger = menu.trigger;
    const closeFromOutside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      queueMicrotask(() => {
        if (trigger?.isConnected && !document.querySelector(".node-context-menu")) trigger.focus();
      });
    };
  }, [menu, onClose]);
  if (!menu) return null;
  const node = nodes.find((item) => item.id === menu.id);
  return createPortal(
    <div
      ref={panel}
      className="node-context-menu material-popover"
      data-figure-node-context-menu
      style={position}
    >
      <ContextMenu label={t("elementActions")} onClose={onClose}>
        <MenuItem
          icon={<UserRound />}
          label={t("openInInspector")}
          onSelect={() => onOpenInspector(menu.id)}
        />
        <MenuItem icon={<Link2 />} label={t("connect")} onSelect={() => onConnect(menu.id)} />
        <MenuItem
          icon={<Star />}
          label={node?.important ? t("unmarkImportant") : t("markImportant")}
          onSelect={() => {
            if (node) onPatch(node.id, { important: !node.important });
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 />}
          label={t("deleteElement")}
          tone="danger"
          onSelect={() => onDelete(menu.id)}
        />
      </ContextMenu>
    </div>,
    document.body,
  );
}
