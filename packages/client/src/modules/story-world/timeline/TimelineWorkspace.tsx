import { useEffect, useState } from "react";
import type { FigureState, TimeSystem, TimeSystemKind, TimelineMoment } from "../model";
import { uid } from "../../../shared/id";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import {
  insertTimelineMoment,
  insertTimelineMomentAtTime,
  moveTimelineMoment,
  removeTimelineMoment,
  setTimelineMomentTime,
} from "./order";
import { normalizeTimeSystem, timeOfMoment } from "./timeSystem";
import { useI18n } from "../../../i18n";
import { MomentBoard } from "./MomentBoard";
import { MomentHeader } from "./MomentHeader";
import { MomentCalendarFields, RelativeMomentFields } from "./MomentTimeFields";
import { MomentStateWorkspace } from "./StateChangePanels";
import { TimelineToolbar } from "./TimelineToolbar";
import { countMomentChanges, defaultDisplayFormat } from "./timelinePresentation";
import "./TimelineWorkspace.css";

export function TimelineWorkspace({
  state,
  onChange,
  targetId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: {
  state: FigureState;
  onChange: (value: FigureState) => void;
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
  const [relativeAmount, setRelativeAmount] = useState(1);
  const [relativeDirection, setRelativeDirection] = useState<"before" | "after">("after");
  const [relativeBaseId, setRelativeBaseId] = useState(() => timeline[0]?.id || "");
  const selected = timeline.find((moment) => moment.id === selectedId) || null;
  const selectedIndex = selected ? timeline.findIndex((moment) => moment.id === selected.id) : -1;
  const timeSystem = normalizeTimeSystem(state.timeSystem);

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
  }, [selectedId]);

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
  const patchMomentTime = (value: number, patch: Partial<TimelineMoment> = {}) => {
    if (!selected || !Number.isSafeInteger(value)) return;
    onChange({
      ...state,
      timeline: setTimelineMomentTime(timeline, selected.id, value).map((moment) =>
        moment.id === selected.id ? { ...moment, ...patch } : moment,
      ),
    });
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
    onChange({ ...state, timeline: moveTimelineMoment(timeline, momentId, targetIndex) });
    setSelectedId(momentId);
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
    <>
      <MomentHeader
        moment={selected}
        index={selectedIndex}
        total={timeline.length}
        changeCount={countMomentChanges(state, selected.id)}
        onSelectPrevious={() => setSelectedId(timeline[selectedIndex - 1]?.id)}
        onSelectNext={() => setSelectedId(timeline[selectedIndex + 1]?.id)}
        onMoveEarlier={() => moveMoment(-1)}
        onMoveLater={() => moveMoment(1)}
        onDuplicate={duplicateMoment}
        onDelete={() => setDeleteMoment(selected)}
        t={t}
      />
      <section className="timeline-meta-card">
        <label className="field">
          <span>{t("name")}</span>
          <input
            value={selected.title}
            onChange={(event) => patchMoment({ title: event.target.value })}
          />
        </label>
        {timeSystem.kind !== "relative" && (
          <MomentCalendarFields
            system={timeSystem}
            moment={selected}
            fallback={selectedIndex}
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
            locale={locale}
            t={t}
          />
        )}
        {timeSystem.kind === "relative" && timeline.length > 1 && (
          <RelativeMomentFields
            system={timeSystem}
            timeline={timeline}
            selected={selected}
            amount={relativeAmount}
            direction={relativeDirection}
            baseId={relativeBaseId}
            onChange={patchRelativePlacement}
            t={t}
          />
        )}
        <label className="field timeline-note">
          <span>{t("optionalNote")}</span>
          <textarea
            value={selected.note || ""}
            placeholder={t("timelineNotePlaceholder")}
            onChange={(event) => patchMoment({ note: event.target.value })}
          />
        </label>
      </section>
    </>
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
          confirmLabel={t("deleteMoment")}
          undoable
          onClose={() => setDeleteMoment(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}
