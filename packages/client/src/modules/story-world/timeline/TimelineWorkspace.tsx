import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../../design";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import { type Chapter, type Manuscript, orderedChapters } from "../../manuscript";
import type { FigureState, TimelineMoment, TimeSystem, TimeSystemKind } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { MomentBoard } from "./MomentBoard";
import { MomentEditor } from "./MomentEditor";
import type { TimelineChapterReference } from "./MomentHeader";
import {
  insertTimelineMoment,
  insertTimelineMomentAtTime,
  moveTimelineMoment,
  removeTimelineMoment,
  setTimelineMomentTime,
} from "./order";
import { MomentStateWorkspace } from "./StateChangePanels";
import { TimelineToolbar } from "./TimelineToolbar";
import { countMomentChanges, defaultDisplayFormat } from "./timelinePresentation";
import { normalizeTimeSystem, timeOfMoment } from "./timeSystem";
import "./TimelineWorkspace.css";

export function chaptersUsingTimelineMoment(
  manuscript: Readonly<Manuscript>,
  momentId: string,
): TimelineChapterReference[] {
  return orderedChapters(manuscript)
    .filter(
      (chapter) =>
        chapter.storyTime?.startMomentId === momentId ||
        chapter.storyTime?.endMomentId === momentId,
    )
    .map(({ id, title }) => ({ id, title }));
}

function chapterReference(chapter: Readonly<Chapter>): TimelineChapterReference {
  return { id: chapter.id, title: chapter.title };
}

/** Mirrors the backend's canonical (time, incoming array index) range comparison. */
export function firstReversedChapterTimeRange(
  manuscript: Readonly<Manuscript>,
  timeline: readonly TimelineMoment[],
): TimelineChapterReference | null {
  const coordinates = new Map(
    timeline.map((moment, index) => [
      moment.id,
      [Number.isInteger(moment.time) ? (moment.time as number) : index, index] as const,
    ]),
  );
  for (const chapter of orderedChapters(manuscript)) {
    const { startMomentId, endMomentId } = chapter.storyTime || {};
    if (!startMomentId || !endMomentId) continue;
    const start = coordinates.get(startMomentId);
    const end = coordinates.get(endMomentId);
    if (!start || !end) continue;
    if (end[0] < start[0] || (end[0] === start[0] && end[1] < start[1]))
      return chapterReference(chapter);
  }
  return null;
}

export function TimelineWorkspace({
  state,
  onChange,
  manuscript,
  onOpenChapter,
  targetId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: {
  state: FigureState;
  onChange: (value: FigureState) => void;
  manuscript: Readonly<Manuscript>;
  onOpenChapter?: (chapterId: string) => void;
  targetId?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const { locale, t } = useI18n();
  const timeline = state.timeline || [];
  const [selectedId, setSelectedId] = useState<string | null>(
    () => targetId || timeline[0]?.id || null,
  );
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [rangeConflict, setRangeConflict] = useState<TimelineChapterReference | null>(null);
  const [relativeAmount, setRelativeAmount] = useState(1);
  const [relativeDirection, setRelativeDirection] = useState<"before" | "after">("after");
  const [relativeBaseId, setRelativeBaseId] = useState(() => timeline[0]?.id || "");
  const selected = timeline.find((moment) => moment.id === selectedId) || null;
  const selectedIndex = selected ? timeline.findIndex((moment) => moment.id === selected.id) : -1;
  const timeSystem = normalizeTimeSystem(state.timeSystem);
  const selectedChapterReferences = selected
    ? chaptersUsingTimelineMoment(manuscript, selected.id)
    : [];

  useEffect(() => {
    if (targetId && timeline.some((moment) => moment.id === targetId)) setSelectedId(targetId);
  }, [targetId, timeline]);
  useEffect(() => {
    if (!selectedId && timeline.length) setSelectedId(timeline[0].id);
  }, [selectedId, timeline]);
  useEffect(() => {
    if (!selected) return;
    const base = timeline[selectedIndex - 1] || timeline[selectedIndex + 1];
    if (!base) return;
    const delta = timeOfMoment(selected, selectedIndex) - timeOfMoment(base);
    setRelativeBaseId(base.id);
    setRelativeDirection(delta < 0 ? "before" : "after");
    setRelativeAmount(Math.abs(delta));
  }, [selected, selectedIndex, timeline]);

  const addMomentAt = (index: number, preferredTime?: number) => {
    const moment: TimelineMoment = { id: uid("t"), title: t("newMoment") };
    const next =
      preferredTime === undefined
        ? insertTimelineMoment(timeline, moment, index)
        : insertTimelineMomentAtTime(timeline, moment, index, preferredTime);
    onChange({ ...state, timeline: next });
    setSelectedId(moment.id);
  };
  const addMoment = () => {
    const lastTime = timeline.length ? timeOfMoment(timeline[timeline.length - 1]) : -1;
    const nextTime = lastTime < Number.MAX_SAFE_INTEGER ? lastTime + 1 : lastTime;
    addMomentAt(timeline.length, nextTime);
  };
  const patchTimeSystem = (patch: Partial<TimeSystem>) =>
    onChange({ ...state, timeSystem: { ...timeSystem, ...patch } });
  const switchTimeSystem = (kind: TimeSystemKind) =>
    patchTimeSystem({
      kind,
      name:
        kind === "custom" && timeSystem.kind !== "custom"
          ? t("timelineTimeCustom")
          : timeSystem.name,
      unit: kind === "relative" ? timeSystem.unit : "day",
      displayFormat:
        kind !== "relative" && kind !== timeSystem.kind
          ? defaultDisplayFormat(kind)
          : timeSystem.displayFormat,
      months:
        kind === "custom" && !timeSystem.months.length
          ? [{ name: t("timelineMonthDefault", { number: 1 }), shortName: "M1", dayCount: 30 }]
          : timeSystem.months,
    });
  const patchMoment = (patch: Partial<TimelineMoment>) =>
    selected &&
    onChange({
      ...state,
      timeline: timeline.map((moment) =>
        moment.id === selected.id ? { ...moment, ...patch } : moment,
      ),
    });
  const commitTimeline = (nextTimeline: TimelineMoment[]) => {
    const conflict = firstReversedChapterTimeRange(manuscript, nextTimeline);
    if (conflict) {
      setRangeConflict(conflict);
      return false;
    }
    setRangeConflict(null);
    onChange({ ...state, timeline: nextTimeline });
    return true;
  };
  const patchMomentTime = (value: number, patch: Partial<TimelineMoment> = {}) => {
    if (!selected || !Number.isSafeInteger(value)) return;
    commitTimeline(
      setTimelineMomentTime(timeline, selected.id, value).map((moment) =>
        moment.id === selected.id ? { ...moment, ...patch } : moment,
      ),
    );
  };
  const patchRelativePlacement = (
    amount: number,
    direction: "before" | "after",
    baseId: string,
  ) => {
    setRelativeAmount(amount);
    setRelativeDirection(direction);
    setRelativeBaseId(baseId);
    const base = timeline.find((moment) => moment.id === baseId);
    if (!base) return;
    const nextTime = timeOfMoment(base) + amount * (direction === "before" ? -1 : 1);
    if (Number.isSafeInteger(nextTime)) patchMomentTime(nextTime);
  };
  const moveMomentTo = (momentId: string, targetIndex: number) => {
    const from = timeline.findIndex((moment) => moment.id === momentId);
    if (from < 0) return;
    setSelectedId(momentId);
    commitTimeline(moveTimelineMoment(timeline, momentId, targetIndex));
  };
  const moveMoment = (offset: number) =>
    selected && moveMomentTo(selected.id, selectedIndex + offset + (offset > 0 ? 1 : 0));
  const duplicateMoment = () => {
    if (!selected) return;
    const copy = {
      ...selected,
      id: uid("t"),
      title: t("copyName", { name: selected.title || t("untitled") }),
    };
    const next = insertTimelineMoment(
      timeline,
      copy,
      selectedIndex + 1,
      selected.time ?? selectedIndex,
    );
    const presence = state.presence ?? [];
    onChange({
      ...state,
      timeline: next,
      edges: state.edges.map((edge) => ({
        ...edge,
        versions: [
          ...(edge.versions || []),
          ...(edge.versions || [])
            .filter((version) => version.momentId === selected.id)
            .map((version) => ({ ...version, momentId: copy.id })),
        ],
      })),
      nodes: state.nodes,
      presence: [
        ...presence,
        ...presence
          .filter((entry) => entry.momentId === selected.id)
          .map((entry) => ({ ...entry, momentId: copy.id })),
      ],
    });
    setSelectedId(copy.id);
  };
  const confirmDelete = () => {
    if (!deleteMoment) return;
    if (chaptersUsingTimelineMoment(manuscript, deleteMoment.id).length) {
      setSelectedId(deleteMoment.id);
      setDeleteMoment(null);
      return;
    }
    const remaining = removeTimelineMoment(timeline, deleteMoment.id);
    onChange({
      ...state,
      timeline: remaining,
      edges: state.edges.map((edge) => ({
        ...edge,
        versions: edge.versions?.filter((version) => version.momentId !== deleteMoment.id),
      })),
      nodes: state.nodes.map((node) =>
        node.diedMomentId === deleteMoment.id ? { ...node, diedMomentId: undefined } : node,
      ),
      presence: (state.presence ?? []).filter((entry) => entry.momentId !== deleteMoment.id),
    });
    setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id || null);
    setDeleteMoment(null);
  };

  const editor = selected ? (
    <MomentEditor
      state={state}
      timeline={timeline}
      system={timeSystem}
      moment={selected}
      index={selectedIndex}
      relativeAmount={relativeAmount}
      relativeDirection={relativeDirection}
      relativeBaseId={relativeBaseId}
      chapterReferences={selectedChapterReferences}
      rangeConflict={rangeConflict}
      locale={locale}
      t={t}
      onOpenChapter={onOpenChapter}
      onSelectPrevious={() => setSelectedId(timeline[selectedIndex - 1]?.id)}
      onSelectNext={() => setSelectedId(timeline[selectedIndex + 1]?.id)}
      onMoveEarlier={() => moveMoment(-1)}
      onMoveLater={() => moveMoment(1)}
      onDuplicate={duplicateMoment}
      onDelete={() => {
        if (!selectedChapterReferences.length) setDeleteMoment(selected);
      }}
      onPatch={patchMoment}
      onStartChange={(time, precision) =>
        patchMomentTime(time, {
          precision,
          ...(Number.isSafeInteger(selected.endTime) && (selected.endTime as number) < time
            ? { endTime: time }
            : {}),
        })
      }
      onEndChange={(endTime, endPrecision) => patchMoment({ endTime, endPrecision })}
      onClearEnd={() => patchMoment({ endTime: undefined, endPrecision: undefined })}
      onRelativeChange={patchRelativePlacement}
    />
  ) : null;

  return (
    <section className="timeline-workspace" aria-label={t("timeline")}>
      <TimelineToolbar
        system={timeSystem}
        momentCount={timeline.length}
        relationshipCount={state.edges.length}
        onKindChange={switchTimeSystem}
        onPatchSystem={patchTimeSystem}
        onAddMoment={addMoment}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        locale={locale}
        t={t}
      />
      <MomentBoard
        state={state}
        timeline={timeline}
        system={timeSystem}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={moveMomentTo}
        t={t}
      />
      {selected && editor && (
        <MomentStateWorkspace
          state={state}
          onChange={onChange}
          moment={selected}
          editor={editor}
          t={t}
        />
      )}
      {deleteMoment && (
        <ConfirmDialog
          title={t("deleteMoment")}
          description={t("timelineDeleteDescription", {
            title: deleteMoment.title,
            count: countMomentChanges(state, deleteMoment.id),
          })}
          supportingText={t("undoHint", { shortcut: storyShortcutLabel("Z", locale) })}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteMoment")}
          onClose={() => setDeleteMoment(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}
