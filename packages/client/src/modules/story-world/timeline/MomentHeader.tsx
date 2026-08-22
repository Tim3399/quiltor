import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
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

export type TimelineChapterReference = Readonly<{
  id: string;
  title: string;
}>;

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
  chapterReferences,
  rangeConflict,
  onOpenChapter,
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
  chapterReferences: readonly TimelineChapterReference[];
  rangeConflict: TimelineChapterReference | null;
  onOpenChapter?: (chapterId: string) => void;
  t: Translate;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const run = (action: () => void) => {
    action();
    setActionsOpen(false);
  };
  const chapterTitle = (chapter: TimelineChapterReference) => chapter.title || t("untitled");
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
        {chapterReferences.length > 0 && (
          <div className="storyboard-chapter-usage">
            <BookOpen aria-hidden="true" />
            <p>
              {t(
                chapterReferences.length === 1
                  ? "timelineMomentUsedByChapter"
                  : "timelineMomentUsedByChapters",
                {
                  count: chapterReferences.length,
                  chapters: chapterReferences
                    .map((chapter) => `„${chapterTitle(chapter)}“`)
                    .join(", "),
                },
              )}
            </p>
            {onOpenChapter && (
              <button
                type="button"
                className="secondary-action"
                onClick={() => onOpenChapter(chapterReferences[0].id)}
              >
                {t("timelineOpenChapter", { chapter: chapterTitle(chapterReferences[0]) })}
              </button>
            )}
          </div>
        )}
        {rangeConflict && (
          <div className="storyboard-range-conflict" role="alert">
            <AlertTriangle aria-hidden="true" />
            <p>
              <strong>{t("timelineRangeConflictTitle")}</strong>
              <span>
                {t("timelineRangeConflictDescription", {
                  chapter: chapterTitle(rangeConflict),
                })}
              </span>
            </p>
            {onOpenChapter && (
              <button
                type="button"
                className="secondary-action"
                onClick={() => onOpenChapter(rangeConflict.id)}
              >
                {t("timelineOpenChapter", { chapter: chapterTitle(rangeConflict) })}
              </button>
            )}
          </div>
        )}
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
            <MenuItem disabled={chapterReferences.length > 0} onSelect={() => run(onDelete)}>
              <Trash2 />
              {t("delete")}
            </MenuItem>
          </Menu>
        </Popover>
      </div>
    </header>
  );
}
