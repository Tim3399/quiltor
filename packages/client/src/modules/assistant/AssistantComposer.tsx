import { ArrowUp, BookOpen, ChevronDown, Square } from "lucide-react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
} from "react";
import { Button, Checkbox, IconButton, Popover, ScrollArea, TextArea } from "../../design";
import { useI18n } from "../../i18n";
import type { Chapter } from "../manuscript";
import "./AssistantComposer.css";

export function AssistantComposer({
  chapters,
  forcedChapterIds,
  onForcedChapterIdsChange,
  chapterPickerRef,
  chapterPickerOpen,
  onChapterPickerOpenChange,
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
  chapterPickerRef: RefObject<HTMLButtonElement | null>;
  chapterPickerOpen: boolean;
  onChapterPickerOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  sending: boolean;
  unavailable: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const chapterPickerId = useId();
  const firstChapter = useRef<HTMLInputElement>(null);
  const chapterPickerLabel = t("pickChaptersIndividually");

  useEffect(() => {
    if (!chapterPickerOpen) return;
    const frame = requestAnimationFrame(() => firstChapter.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [chapterPickerOpen]);

  return (
    <footer>
      {!!chapters.length && (
        <div className="assistant-chapter-picker">
          <Button
            ref={chapterPickerRef}
            className="assistant-chapter-picker-trigger"
            appearance="ghost"
            size="compact"
            icon={<ChevronDown className="assistant-chapter-picker-chevron" />}
            aria-haspopup="dialog"
            aria-expanded={chapterPickerOpen}
            aria-controls={chapterPickerOpen ? chapterPickerId : undefined}
            onClick={() => onChapterPickerOpenChange(!chapterPickerOpen)}
          >
            {forcedChapterIds.length
              ? t("contextNChaptersForced").replace("{n}", String(forcedChapterIds.length))
              : t("contextEntireWorld")}
          </Button>
          <Popover
            anchorRef={chapterPickerRef}
            open={chapterPickerOpen}
            label={chapterPickerLabel}
            onClose={() => onChapterPickerOpenChange(false)}
          >
            <ScrollArea
              id={chapterPickerId}
              className="assistant-chapter-picker-list"
              axis="y"
              gutter="stable"
              overscroll="contain"
              scrollbar="thin"
              surface="panel"
              role="group"
              aria-label={chapterPickerLabel}
            >
              {chapters.map((chapter, index) => (
                <Checkbox
                  ref={index === 0 ? firstChapter : undefined}
                  key={chapter.id}
                  containerClassName="assistant-chapter-option"
                  data-autofocus={index === 0 || undefined}
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
            </ScrollArea>
          </Popover>
        </div>
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
