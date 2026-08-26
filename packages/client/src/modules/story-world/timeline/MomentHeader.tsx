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
import { useRef, useState } from "react";
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Popover } from "../../../design";
import type { Translate } from "../../../i18n";
import type { TimelineMoment } from "../model";
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
        <IconButton
          className="storyboard-stepper-action"
          label={t("timelinePrevious")}
          icon={<ChevronLeft />}
          disabled={index <= 0}
          onClick={onSelectPrevious}
        />
        <span>{t("timelineOf", { current: index + 1, total })}</span>
        <IconButton
          className="storyboard-stepper-action"
          label={t("timelineNext")}
          icon={<ChevronRight />}
          disabled={index >= total - 1}
          onClick={onSelectNext}
        />
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
              <Button
                className="storyboard-chapter-action"
                onClick={() => onOpenChapter(chapterReferences[0].id)}
              >
                {t("timelineOpenChapter", { chapter: chapterTitle(chapterReferences[0]) })}
              </Button>
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
              <Button
                className="storyboard-chapter-action"
                onClick={() => onOpenChapter(rangeConflict.id)}
              >
                {t("timelineOpenChapter", { chapter: chapterTitle(rangeConflict) })}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="storyboard-actions">
        <Button
          ref={actionsButton}
          className="storyboard-actions-trigger"
          appearance="ghost"
          icon={<MoreHorizontal />}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          {t("menuActions")}
        </Button>
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
