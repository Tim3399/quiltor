import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { TimelineMoment } from "../model";
import type { Translate } from "../../../i18n";
import { Menu, MenuItem, MenuSeparator } from "../../../shared/ui/Menu";
import { Popover } from "../../../shared/ui/Popover";
import "./MomentHeader.css";

export function MomentHeader({
  moment,
  index,
  total,
  changeCount,
  onSelectPrevious,
  onSelectNext,
  onMoveEarlier,
  onMoveLater,
  onDuplicate,
  onDelete,
  t,
}: {
  moment: TimelineMoment;
  index: number;
  total: number;
  changeCount: number;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  t: Translate;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const run = (action: () => void) => {
    action();
    setActionsOpen(false);
  };
  return (
    <header className="storyboard-header">
      <div className="storyboard-stepper">
        <button disabled={index <= 0} onClick={onSelectPrevious} aria-label={t("timelinePrevious")}>
          <ChevronLeft />
        </button>
        <span>{t("timelineOf", { current: index + 1, total })}</span>
        <button disabled={index >= total - 1} onClick={onSelectNext} aria-label={t("timelineNext")}>
          <ChevronRight />
        </button>
      </div>
      <div className="storyboard-title">
        <span>{t("timelinePoint", { number: index + 1 })}</span>
        <h1>{moment.title || t("untitled")}</h1>
        <small>{t("timelineOwnChanges", { count: changeCount })}</small>
      </div>
      <div className="storyboard-actions">
        <button
          ref={actionsButton}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          <MoreHorizontal />
          {t("menuActions")}
        </button>
        <Popover
          anchorRef={actionsButton}
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          label={t("timelineActions")}
        >
          <Menu label={t("timelineActions")} onClose={() => setActionsOpen(false)}>
            <MenuItem disabled={index === 0} onSelect={() => run(onMoveEarlier)}>
              <ArrowUp />
              {t("timelineEarlier")}
            </MenuItem>
            <MenuItem disabled={index === total - 1} onSelect={() => run(onMoveLater)}>
              <ArrowDown />
              {t("timelineLater")}
            </MenuItem>
            <MenuItem onSelect={() => run(onDuplicate)}>
              <Copy />
              {t("timelineDuplicate")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => run(onDelete)}>
              <Trash2 />
              {t("delete")}
            </MenuItem>
          </Menu>
        </Popover>
      </div>
    </header>
  );
}
