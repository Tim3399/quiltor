import { useState } from "react";
import { ChevronDown, ChevronUp, Download, Trash2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import type { TimeSystem, TimelineMoment } from "../story-world";
import { ChapterStoryTimeFields, chapterStoryTimeLabel } from "./ChapterStoryTimeFields";
import type { Chapter, Manuscript } from "./model";
import { wordCount } from "./wordCount";
import "./ChapterBinder.css";

interface ChapterBinderProps {
  manuscript: Manuscript;
  current?: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  totalWords: number;
  viewportMode: ViewportMode;
  onClose: () => void;
  onSelect: (id: string) => void;
  onMove: (delta: number) => void;
  onReorder: (chapters: Chapter[]) => void;
  onUpdateCurrent: (patch: Partial<Chapter>) => void;
  onExportCurrent: () => void;
  onRequestDelete: () => void;
}

export function ChapterBinder({
  manuscript,
  current,
  timeline,
  timeSystem,
  totalWords,
  viewportMode,
  onClose,
  onSelect,
  onMove,
  onReorder,
  onUpdateCurrent,
  onExportCurrent,
  onRequestDelete,
}: ChapterBinderProps) {
  const { t } = useI18n();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const currentIndex = current ? manuscript.chapters.indexOf(current) + 1 : 0;

  return (
    <>
      <div className="panel-heading panel-heading--binder">
        <span>{t("chapters")}</span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("closeNavigation")}
          title={t("closeNavigation")}
        >
          <X />
        </button>
      </div>
      {current && (
        <section className="binder-chapter-actions">
          <span>{t("chapterActions")}</span>
          <div
            role="group"
            aria-label={`${t("chapterActions")}: ${current.title || t("untitled")}`}
          >
            <button
              type="button"
              className="icon-button"
              disabled={currentIndex <= 1}
              onClick={() => onMove(-1)}
              aria-label={t("moveUp")}
              title={t("moveUp")}
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={currentIndex >= manuscript.chapters.length}
              onClick={() => onMove(1)}
              aria-label={t("moveDown")}
              title={t("moveDown")}
            >
              <ChevronDown />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onExportCurrent}
              aria-label={t("chapterMarkdown")}
              title={t("chapterMarkdown")}
            >
              <Download />
            </button>
            <button
              type="button"
              className="icon-button chapter-action-delete"
              onClick={onRequestDelete}
              aria-label={t("deleteChapter")}
              title={t("deleteChapter")}
            >
              <Trash2 />
            </button>
          </div>
        </section>
      )}
      <div className="chapter-list">
        {manuscript.chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            draggable
            className={chapter.id === current?.id ? "active" : ""}
            onClick={() => {
              onSelect(chapter.id);
              if (viewportMode === "compact") onClose();
            }}
            onDragStart={() => setDraggedId(chapter.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!draggedId || draggedId === chapter.id) return;
              const next = [...manuscript.chapters];
              const from = next.findIndex((item) => item.id === draggedId);
              const to = next.findIndex((item) => item.id === chapter.id);
              const [item] = next.splice(from, 1);
              next.splice(to, 0, item);
              onReorder(next);
              setDraggedId(null);
            }}
          >
            <span className="chapter-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="chapter-name">{chapter.title || t("untitled")}</span>
            <span className="chapter-words">
              {wordCount(chapter.body)} {t("words")}
            </span>
            <span className="chapter-story-time-summary">
              {chapterStoryTimeLabel(chapter, timeline, timeSystem, t)}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <>
          <ChapterStoryTimeFields
            chapter={current}
            timeline={timeline}
            timeSystem={timeSystem}
            onChange={(storyTime) => onUpdateCurrent({ storyTime })}
          />
          <label className="field binder-note">
            <span>{t("chapterNote")}</span>
            <textarea
              value={current.note}
              onChange={(event) => onUpdateCurrent({ note: event.target.value })}
              placeholder={t("chapterNotePlaceholder")}
            />
          </label>
        </>
      )}
      <footer>
        {manuscript.chapters.length} {t("chapters")} ·{" "}
        {(totalWords / 250).toFixed(1).replace(".", ",")} {t("standardPages")}
      </footer>
    </>
  );
}
