import { ChevronDown, ChevronUp, Download, Ellipsis, Trash2 } from "lucide-react";
import { DropdownMenu, IconButton, MenuItem, MenuSeparator } from "../../design";
import { useI18n } from "../../i18n";
import "./ChapterActionsMenu.css";

export interface ChapterActionsMenuProps {
  title: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onExport: () => void;
  onDelete: () => void;
}

/** Keeps chapter-level commands attached to the selected chapter without competing with navigation. */
export function ChapterActionsMenu({
  title,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onExport,
  onDelete,
}: ChapterActionsMenuProps) {
  const { t } = useI18n();
  const label = `${t("chapterActions")}: ${title}`;

  return (
    <DropdownMenu
      label={label}
      header={
        <div className="binder-chapter-menu-header">
          <span>{t("chapterActions")}</span>
          <strong>{title}</strong>
        </div>
      }
      renderTrigger={({ ref, ...triggerProps }) => (
        <IconButton
          {...triggerProps}
          ref={ref}
          className="binder-chapter-action-trigger"
          icon={<Ellipsis />}
          label={label}
          title={label}
        />
      )}
    >
      <MenuItem
        icon={<ChevronUp />}
        label={t("moveUp")}
        disabled={!canMoveUp}
        onSelect={onMoveUp}
      />
      <MenuItem
        icon={<ChevronDown />}
        label={t("moveDown")}
        disabled={!canMoveDown}
        onSelect={onMoveDown}
      />
      <MenuSeparator />
      <MenuItem icon={<Download />} label={t("chapterMarkdown")} onSelect={onExport} />
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} label={t("deleteChapter")} tone="danger" onSelect={onDelete} />
    </DropdownMenu>
  );
}
