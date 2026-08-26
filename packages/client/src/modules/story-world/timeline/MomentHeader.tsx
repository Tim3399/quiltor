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
import { Button, DropdownMenu, IconButton, MenuItem, MenuSeparator } from "../../../design";
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
        <DropdownMenu
          label={t("timelineActions")}
          renderTrigger={({ ref, ...triggerProps }) => (
            <Button
              {...triggerProps}
              ref={ref}
              className="storyboard-actions-trigger"
              appearance="ghost"
              icon={<MoreHorizontal />}
            >
              {t("menuActions")}
            </Button>
          )}
        >
          <MenuItem
            icon={<ArrowUp />}
            label={t("timelineEarlier")}
            disabled={index === 0}
            onSelect={onMoveEarlier}
          />
          <MenuItem
            icon={<ArrowDown />}
            label={t("timelineLater")}
            disabled={index === total - 1}
            onSelect={onMoveLater}
          />
          <MenuItem icon={<Copy />} label={t("timelineDuplicate")} onSelect={onDuplicate} />
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            label={t("delete")}
            disabled={chapterReferences.length > 0}
            tone="danger"
            onSelect={onDelete}
          />
        </DropdownMenu>
      </div>
    </header>
  );
}
