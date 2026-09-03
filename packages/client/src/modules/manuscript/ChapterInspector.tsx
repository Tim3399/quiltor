import { ChevronDown, ChevronUp, Download, Trash2 } from "lucide-react";
import { Button, SidePanelBody } from "../../design";
import { useI18n } from "../../i18n";
import { NoteEditor, noteFocusCopy } from "../notes";
import type { TimelineMoment, TimeSystem } from "../story-world";
import type { ChapterActionsMenuProps } from "./ChapterActionsMenu";
import { ChapterStoryTimeFields } from "./ChapterStoryTimeFields";
import type { Chapter } from "./model";
import { wordCount } from "./wordCount";
import "./ChapterInspector.css";

export interface ChapterInspectorProps {
  current: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  actions: ChapterActionsMenuProps;
  onUpdateCurrent: (patch: Partial<Chapter>) => void;
}

/**
 * Everything the selected chapter can be told to do.
 *
 * The binder on the left answers "which chapter", this panel answers "what about it" --
 * counts, note, story time and placement. Keeping the two apart is what makes the
 * three-column layout readable: structure on one side, controls on the other.
 */
export function ChapterInspector({
  current,
  timeline,
  timeSystem,
  actions,
  onUpdateCurrent,
}: ChapterInspectorProps) {
  const { t, locale } = useI18n();
  const words = wordCount(current.body);

  return (
    <SidePanelBody className="chapter-inspector">
      <dl className="chapter-inspector__stats">
        <div>
          <dt>{t("words")}</dt>
          <dd>{words.toLocaleString(locale)}</dd>
        </div>
        <div>
          <dt>{t("characters")}</dt>
          <dd>{current.body.length.toLocaleString(locale)}</dd>
        </div>
        <div>
          <dt>{t("standardPages")}</dt>
          <dd>{(words / 250).toFixed(1).replace(".", ",")}</dd>
        </div>
      </dl>

      <NoteEditor
        key={current.id}
        owner={{ kind: "chapter", id: current.id }}
        fieldClassName="chapter-inspector__note"
        label={t("chapterNote")}
        value={current.note}
        references={current.noteReferences}
        marks={current.noteMarks}
        onChange={(note, noteReferences, noteMarks) =>
          onUpdateCurrent({ note, noteReferences, noteMarks })
        }
        placeholder={t("chapterNotePlaceholder")}
        rows={6}
        focus={noteFocusCopy(t, current.title || t("untitled"))}
      />

      <ChapterStoryTimeFields
        key={`${current.id}-time`}
        chapter={current}
        timeline={timeline}
        timeSystem={timeSystem}
        onChange={(storyTime) => onUpdateCurrent({ storyTime })}
      />

      <div className="chapter-inspector__placement">
        <Button
          appearance="secondary"
          size="compact"
          icon={<ChevronUp />}
          disabled={!actions.canMoveUp}
          onClick={actions.onMoveUp}
        >
          {t("moveUp")}
        </Button>
        <Button
          appearance="secondary"
          size="compact"
          icon={<ChevronDown />}
          disabled={!actions.canMoveDown}
          onClick={actions.onMoveDown}
        >
          {t("moveDown")}
        </Button>
      </div>

      <Button
        className="chapter-inspector__wide"
        appearance="secondary"
        size="compact"
        icon={<Download />}
        onClick={actions.onExport}
      >
        {t("chapterMarkdown")}
      </Button>
      <Button
        className="chapter-inspector__wide"
        appearance="ghost"
        tone="danger"
        size="compact"
        icon={<Trash2 />}
        onClick={actions.onDelete}
      >
        {t("deleteChapter")}
      </Button>
    </SidePanelBody>
  );
}
