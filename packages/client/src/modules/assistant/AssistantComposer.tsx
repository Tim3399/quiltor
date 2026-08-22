import type { Dispatch, RefObject, SetStateAction } from "react";
import { ArrowUp, BookOpen, ChevronDown, Square } from "lucide-react";
import { useI18n } from "../../i18n";
import type { Chapter } from "../manuscript";
import "./AssistantComposer.css";

export function AssistantComposer({
  chapters,
  forcedChapterIds,
  onForcedChapterIdsChange,
  chapterPickerRef,
  draft,
  onDraftChange,
  sending,
  unavailable,
  onSend,
  onCancel,
}: {
  chapters: Chapter[];
  forcedChapterIds: string[];
  onForcedChapterIdsChange: Dispatch<SetStateAction<string[]>>;
  chapterPickerRef: RefObject<HTMLDetailsElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  sending: boolean;
  unavailable: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <footer>
      {!!chapters.length && (
        <details className="assistant-chapter-picker" ref={chapterPickerRef}>
          <summary>
            <ChevronDown />
            {forcedChapterIds.length
              ? t("contextNChaptersForced").replace("{n}", String(forcedChapterIds.length))
              : t("contextEntireWorld")}
          </summary>
          <div className="assistant-chapter-picker-list">
            {chapters.map((chapter, index) => (
              <label key={chapter.id}>
                <input
                  type="checkbox"
                  checked={forcedChapterIds.includes(chapter.id)}
                  onChange={() =>
                    onForcedChapterIdsChange((current) =>
                      current.includes(chapter.id)
                        ? current.filter((id) => id !== chapter.id)
                        : [...current, chapter.id],
                    )
                  }
                />
                <span>
                  {index + 1}. {chapter.title || t("untitled")}
                </span>
              </label>
            ))}
            {!!forcedChapterIds.length && (
              <button type="button" onClick={() => onForcedChapterIdsChange([])}>
                {t("resetSelection")}
              </button>
            )}
          </div>
        </details>
      )}
      <label>
        <span className="sr-only">{t("messageToAssistantLabel")}</span>
        <textarea
          value={draft}
          disabled={sending || unavailable}
          placeholder={t("messagePlaceholder")}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
      </label>
      {sending ? (
        <button aria-label={t("cancelRequest")} onClick={onCancel}>
          <Square />
        </button>
      ) : (
        <button
          aria-label={t("sendMessage")}
          disabled={!draft.trim() || unavailable}
          onClick={onSend}
        >
          <ArrowUp />
        </button>
      )}
      <small>
        <BookOpen />
        {t("manuscriptReadOnlyNote")}
      </small>
    </footer>
  );
}
