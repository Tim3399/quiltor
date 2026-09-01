import { TextField } from "../../../design";
import type { Translate, UiLocale } from "../../../i18n";
import { NoteEditor, noteFocusCopy } from "../../notes";
import type { FigureState, TimelineMoment, TimeSystem } from "../model";
import { MomentHeader, type TimelineChapterReference } from "./MomentHeader";
import { MomentCalendarFields, RelativeMomentFields } from "./MomentTimeFields";
import { countMomentChanges } from "./timelinePresentation";

export interface MomentEditorProps {
  state: FigureState;
  timeline: TimelineMoment[];
  system: TimeSystem;
  moment: TimelineMoment;
  index: number;
  relativeAmount: number;
  relativeDirection: "before" | "after";
  relativeBaseId: string;
  chapterReferences: TimelineChapterReference[];
  rangeConflict: TimelineChapterReference | null;
  locale: UiLocale;
  t: Translate;
  onOpenChapter?: (chapterId: string) => void;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPatch: (patch: Partial<TimelineMoment>) => void;
  onStartChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onEndChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onClearEnd: () => void;
  onRelativeChange: (amount: number, direction: "before" | "after", baseId: string) => void;
}

/** Complete editor for the selected timeline moment, independent from workspace orchestration. */
export function MomentEditor({
  state,
  timeline,
  system,
  moment,
  index,
  relativeAmount,
  relativeDirection,
  relativeBaseId,
  chapterReferences,
  rangeConflict,
  locale,
  t,
  onOpenChapter,
  onSelectPrevious,
  onSelectNext,
  onMoveEarlier,
  onMoveLater,
  onDuplicate,
  onDelete,
  onPatch,
  onStartChange,
  onEndChange,
  onClearEnd,
  onRelativeChange,
}: MomentEditorProps) {
  return (
    <>
      <MomentHeader
        moment={moment}
        index={index}
        total={timeline.length}
        changeCount={countMomentChanges(state, moment.id)}
        onSelectPrevious={onSelectPrevious}
        onSelectNext={onSelectNext}
        onMoveEarlier={onMoveEarlier}
        onMoveLater={onMoveLater}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        chapterReferences={chapterReferences}
        rangeConflict={rangeConflict}
        onOpenChapter={onOpenChapter}
        t={t}
      />
      <section className="timeline-meta-card">
        <TextField
          fieldClassName="timeline-title-field"
          label={t("name")}
          value={moment.title}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
        {system.kind !== "relative" && (
          <MomentCalendarFields
            system={system}
            moment={moment}
            fallback={index}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onClearEnd={onClearEnd}
            locale={locale}
            t={t}
          />
        )}
        {system.kind === "relative" && timeline.length > 1 && (
          <RelativeMomentFields
            system={system}
            timeline={timeline}
            selected={moment}
            amount={relativeAmount}
            direction={relativeDirection}
            baseId={relativeBaseId}
            onChange={onRelativeChange}
            t={t}
          />
        )}
        <NoteEditor
          owner={{ kind: "timeline", id: moment.id }}
          fieldClassName="timeline-note-field"
          className="timeline-note-control"
          label={t("optionalNote")}
          value={moment.note || ""}
          references={moment.noteReferences}
          marks={moment.noteMarks}
          placeholder={t("timelineNotePlaceholder")}
          onChange={(note, noteReferences, noteMarks) =>
            onPatch({ note, noteReferences, noteMarks })
          }
          focus={noteFocusCopy(t, moment.title)}
        />
      </section>
    </>
  );
}
