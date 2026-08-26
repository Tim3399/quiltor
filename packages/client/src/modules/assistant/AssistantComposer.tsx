import { ArrowUp, BookOpen, ChevronDown, Square } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Button, Checkbox, IconButton, TextArea } from "../../design";
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
              <Checkbox
                key={chapter.id}
                containerClassName="assistant-chapter-option"
                label={
                  <span>
                    {index + 1}. {chapter.title || t("untitled")}
                  </span>
                }
                checked={forcedChapterIds.includes(chapter.id)}
                onChange={() =>
                  onForcedChapterIdsChange((current) =>
                    current.includes(chapter.id)
                      ? current.filter((id) => id !== chapter.id)
                      : [...current, chapter.id],
                  )
                }
              />
            ))}
            {!!forcedChapterIds.length && (
              <Button
                className="assistant-chapter-reset"
                appearance="ghost"
                size="compact"
                onClick={() => onForcedChapterIdsChange([])}
              >
                {t("resetSelection")}
              </Button>
            )}
          </div>
        </details>
      )}
      <TextArea
        className="assistant-composer-input"
        fieldClassName="assistant-composer-field"
        label={t("messageToAssistantLabel")}
        labelHidden
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
      {sending ? (
        <IconButton
          className="assistant-composer-action"
          label={t("cancelRequest")}
          icon={<Square />}
          appearance="primary"
          onClick={onCancel}
        />
      ) : (
        <IconButton
          className="assistant-composer-action"
          label={t("sendMessage")}
          icon={<ArrowUp />}
          appearance="primary"
          disabled={!draft.trim() || unavailable}
          onClick={onSend}
        />
      )}
      <small>
        <BookOpen />
        {t("manuscriptReadOnlyNote")}
      </small>
    </footer>
  );
}
