import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Redo2,
  Settings2,
  Skull,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  FigureEdge,
  FigureNode,
  FigureState,
  TimeSystem,
  TimeSystemKind,
  TimelineMoment,
} from "../../types";
import { uid } from "../../types";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useShortcut } from "../../shared/ui/shortcuts";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";
import { Popover } from "../../shared/ui/Popover";
import { Sheet } from "../../shared/ui/Sheet";
import {
  patchRelationship,
  relationshipLabelEditor,
  resolveRelationship,
} from "../figures/relationships";
import { patchPresence } from "../figures/presence";
import { PresenceBoard } from "./PresenceBoard";
import {
  insertTimelineMoment,
  insertTimelineMomentAtTime,
  moveTimelineMoment,
  removeTimelineMoment,
  setTimelineMomentTime,
} from "./order";
import {
  type CalendarCoordinate,
  calendarCoordinate,
  normalizeTimeSystem,
  projectMomentTime,
  timeFromCalendarCoordinate,
  timeOfMoment,
} from "./timeSystem";
import { useLanguage, type Language, type Translate } from "../../language";
import "./TimelineWorkspace.css";

type BoardMode = "changes" | "state";

function relativeMomentTimeLabel(system: TimeSystem, time: number, t: Translate): string {
  if (time === 0) return t("timelineRelativeStart");
  return t(system.unit === "day" ? "timelineRelativeDay" : "timelineRelativeStep", { time });
}

function momentTimeLabel(
  system: TimeSystem,
  moment: TimelineMoment,
  fallback: number,
  t: Translate,
): string {
  if (system.kind === "relative") {
    const start = relativeMomentTimeLabel(system, timeOfMoment(moment, fallback), t);
    return Number.isSafeInteger(moment.endTime)
      ? `${start} – ${relativeMomentTimeLabel(system, moment.endTime as number, t)}`
      : start;
  }
  const start = projectMomentTime(system, timeOfMoment(moment, fallback), moment.precision);
  return Number.isSafeInteger(moment.endTime)
    ? `${start} – ${projectMomentTime(system, moment.endTime as number, moment.endPrecision)}`
    : start;
}

function defaultDisplayFormat(kind: TimeSystemKind): string {
  return kind === "custom"
    ? "{day} {monthName}, {year} {era}"
    : "{day:02d}.{month:02d}.{year:04d} {era}";
}

function gregorianMonthLabel(language: Language, month: number): string {
  return new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
}

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
  const { language, t } = useLanguage();
  const keys = useShortcut();
  const timeline = state.timeline || [];
  const [selectedId, setSelectedId] = useState<string | null>(
    () => targetId || timeline[0]?.id || null,
  );
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [draggedMomentId, setDraggedMomentId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>("changes");
  const [openSections, setOpenSections] = useState(() => new Set(["relationships"]));
  const [selectedLifeId, setSelectedLifeId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [relativeAmount, setRelativeAmount] = useState(1);
  const [relativeDirection, setRelativeDirection] = useState<"before" | "after">("after");
  const [relativeBaseId, setRelativeBaseId] = useState(() => timeline[0]?.id || "");
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  const actionsButton = useRef<HTMLButtonElement>(null);
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
  useEffect(() => setSelectedEdgeId(null), [selectedId]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 719px)"),
      update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
    const delta = amount * (direction === "before" ? -1 : 1);
    const nextTime = timeOfMoment(base) + delta;
    if (Number.isSafeInteger(nextTime)) patchMomentTime(nextTime);
  };
  const moveMomentTo = (momentId: string, targetIndex: number) => {
    const from = timeline.findIndex((moment) => moment.id === momentId);
    if (from < 0) return;
    const next = moveTimelineMoment(timeline, momentId, targetIndex);
    onChange({ ...state, timeline: next });
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
    setActionsOpen(false);
  };
  const patchEdge = (edge: FigureEdge, patch: Partial<FigureEdge>) =>
    selected &&
    onChange({
      ...state,
      edges: state.edges.map((item) =>
        item.id === edge.id ? patchRelationship(item, timeline, selected.id, patch) : item,
      ),
    });
  const removeEdgeChange = (edge: FigureEdge) =>
    selected &&
    onChange({
      ...state,
      edges: state.edges.map((item) =>
        item.id === edge.id
          ? {
              ...item,
              versions: item.versions?.filter((version) => version.momentId !== selected.id),
            }
          : item,
      ),
    });

  const lifeNodes = useMemo(
    () => state.nodes.filter((node) => node.type === "person" || node.type === "tier"),
    [state.nodes],
  );
  const places = useMemo(() => state.nodes.filter((node) => node.type === "ort"), [state.nodes]);
  const presence = state.presence ?? [];
  const patchPresenceAt = (nodeId: string, placeId: string) =>
    selected &&
    onChange({ ...state, presence: patchPresence(presence, nodeId, selected.id, placeId || null) });
  const edgeChanges = selected
    ? state.edges.filter((edge) =>
        edge.versions?.some((version) => version.momentId === selected.id),
      )
    : [];
  const presenceChanges = selected
    ? presence.filter((entry) => entry.momentId === selected.id)
    : [];
  const lifeChanges = selected ? lifeNodes.filter((node) => node.diedMomentId === selected.id) : [];
  const changes = edgeChanges.length + presenceChanges.length + lifeChanges.length;
  const visibleEdges = mode === "changes" ? edgeChanges : state.edges;
  const selectedEdge = state.edges.find((edge) => edge.id === selectedEdgeId) || null;
  const addRelationshipChange = (edgeId: string) => {
    const edge = state.edges.find((item) => item.id === edgeId);
    if (!edge || !selected) return;
    patchEdge(edge, {});
    setSelectedEdgeId(edge.id);
  };
  const markDeath = (nodeId: string) => {
    if (!selected) return;
    onChange({
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, diedMomentId: node.diedMomentId === selected.id ? undefined : selected.id }
          : node,
      ),
    });
    setSelectedLifeId(null);
  };
  const toggleSection = (section: string) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  return (
    <section className="timeline-workspace" aria-label={t("timeline")}>
      <div className="context-bar">
        <div className="context-title">
          <strong>{t("timeline")}</strong>
          <span>
            {t("nMoments", { n: timeline.length })} ·{" "}
            {t("nRelationships", { n: state.edges.length })}
          </span>
        </div>
        <div className="context-tools">
          <TimeSystemControls
            system={timeSystem}
            onKindChange={switchTimeSystem}
            onPatch={patchTimeSystem}
            language={language}
            t={t}
          />
          <div className="tool-group">
            <button className="primary" onClick={addMoment}>
              <Plus />
              {t("addMoment")}
            </button>
          </div>
          <div className="tool-group">
            <button
              disabled={!canUndo}
              onClick={onUndo}
              aria-label={t("timelineUndo")}
              title={`${t("timelineUndo")} · ${keys("Z")}`}
            >
              <Undo2 />
            </button>
            <button
              disabled={!canRedo}
              onClick={onRedo}
              aria-label={t("timelineRedo")}
              title={`${t("timelineRedo")} · ${keys("Z", { shift: true })}`}
            >
              <Redo2 />
            </button>
          </div>
        </div>
      </div>

      {!timeline.length ? (
        <div className="timeline-manager-empty">
          <Clock3 />
          <h2>{t("timelineEmptyTitle")}</h2>
          <p>{t("timelineEmptyHelp")}</p>
        </div>
      ) : (
        <>
          <nav className="story-timeline" aria-label={t("timeline")}>
            <div className="story-track">
              {timeline.map((moment, index) => (
                <div className="story-moment-wrap" key={moment.id}>
                  <button
                    draggable
                    className={`story-moment ${moment.id === selectedId ? "active" : ""}`}
                    aria-current={moment.id === selectedId ? "step" : undefined}
                    onDragStart={() => setDraggedMomentId(moment.id)}
                    onDragEnd={() => setDraggedMomentId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedMomentId) moveMomentTo(draggedMomentId, index);
                      setDraggedMomentId(null);
                    }}
                    onClick={() => setSelectedId(moment.id)}
                  >
                    <GripVertical aria-hidden="true" />
                    <span>{index + 1}</span>
                    <strong>{moment.title || t("untitled")}</strong>
                    <small>
                      {momentTimeLabel(timeSystem, moment, index, t)} ·{" "}
                      {t("nChanges", { n: countMomentChanges(state, moment.id) })}
                    </small>
                  </button>
                </div>
              ))}
            </div>
          </nav>

          {selected && (
            <div className={`storyboard-layout ${selectedEdge ? "has-inspector" : ""}`}>
              <main className="storyboard-main">
                <header className="storyboard-header">
                  <div className="storyboard-stepper">
                    <button
                      disabled={selectedIndex <= 0}
                      onClick={() => setSelectedId(timeline[selectedIndex - 1]?.id)}
                      aria-label={t("timelinePrevious")}
                    >
                      <ChevronLeft />
                    </button>
                    <span>
                      {t("timelineOf", { current: selectedIndex + 1, total: timeline.length })}
                    </span>
                    <button
                      disabled={selectedIndex >= timeline.length - 1}
                      onClick={() => setSelectedId(timeline[selectedIndex + 1]?.id)}
                      aria-label={t("timelineNext")}
                    >
                      <ChevronRight />
                    </button>
                  </div>
                  <div className="storyboard-title">
                    <span>{t("timelinePoint", { number: selectedIndex + 1 })}</span>
                    <h1>{selected.title || t("untitled")}</h1>
                    <small>{t("timelineOwnChanges", { count: changes })}</small>
                  </div>
                  <div className="storyboard-actions">
                    <button
                      ref={actionsButton}
                      aria-haspopup="menu"
                      aria-expanded={actionsOpen}
                      onClick={() => setActionsOpen((value) => !value)}
                    >
                      <MoreHorizontal />
                      {t("menuActions")}
                    </button>
                    <Popover
                      anchorRef={actionsButton}
                      open={actionsOpen}
                      onClose={() => setActionsOpen(false)}
                      label={t("timelineActions")}
                    >
                      <Menu label={t("timelineActions")} onClose={() => setActionsOpen(false)}>
                        <MenuItem
                          disabled={selectedIndex === 0}
                          onSelect={() => {
                            moveMoment(-1);
                            setActionsOpen(false);
                          }}
                        >
                          <ArrowUp />
                          {t("timelineEarlier")}
                        </MenuItem>
                        <MenuItem
                          disabled={selectedIndex === timeline.length - 1}
                          onSelect={() => {
                            moveMoment(1);
                            setActionsOpen(false);
                          }}
                        >
                          <ArrowDown />
                          {t("timelineLater")}
                        </MenuItem>
                        <MenuItem onSelect={duplicateMoment}>
                          <Copy />
                          {t("timelineDuplicate")}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          onSelect={() => {
                            setDeleteMoment(selected);
                            setActionsOpen(false);
                          }}
                        >
                          <Trash2 />
                          {t("delete")}
                        </MenuItem>
                      </Menu>
                    </Popover>
                  </div>
                </header>

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
                          ...(Number.isSafeInteger(selected.endTime) &&
                          (selected.endTime as number) < time
                            ? { endTime: time }
                            : {}),
                        })
                      }
                      onEndChange={(endTime, endPrecision) =>
                        patchMoment({ endTime, endPrecision })
                      }
                      onClearEnd={() =>
                        patchMoment({ endTime: undefined, endPrecision: undefined })
                      }
                      language={language}
                      t={t}
                    />
                  )}
                  {timeSystem.kind === "relative" && selected && timeline.length > 1 && (
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

                <ManagerSection
                  id="relationships"
                  title={t("relationships")}
                  count={edgeChanges.length}
                  description={
                    mode === "changes" ? t("timelineRelationsChanged") : t("timelineRelationsState")
                  }
                  open={openSections.has("relationships")}
                  onToggle={() => toggleSection("relationships")}
                >
                  <div className="storyboard-mode-row">
                    <span>{t("timelineRelationshipView")}</span>
                    <div className="storyboard-mode" role="group" aria-label={t("timelineView")}>
                      <button aria-pressed={mode === "changes"} onClick={() => setMode("changes")}>
                        {t("timelineOnlyChanges")}
                      </button>
                      <button aria-pressed={mode === "state"} onClick={() => setMode("state")}>
                        {t("timelineWholeState")}
                      </button>
                    </div>
                  </div>
                  <div className="relationship-add">
                    <label>
                      <span className="sr-only">{t("timelineChangeRelation")}</span>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value) addRelationshipChange(event.target.value);
                          event.target.value = "";
                        }}
                      >
                        <option value="">{t("timelineChangeRelation")}</option>
                        {state.edges
                          .filter((edge) => !edgeChanges.includes(edge))
                          .map((edge) => (
                            <option value={edge.id} key={edge.id}>
                              {relationshipName(edge, state.nodes, timeline, selected.id, t)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="relationship-change-list">
                    {visibleEdges.map((edge) => (
                      <RelationshipCard
                        key={edge.id}
                        edge={edge}
                        nodes={state.nodes}
                        timeline={timeline}
                        momentId={selected.id}
                        explicit={edgeChanges.includes(edge)}
                        selected={edge.id === selectedEdgeId}
                        onSelect={() => setSelectedEdgeId(edge.id)}
                        t={t}
                      />
                    ))}
                    {!visibleEdges.length && (
                      <p className="timeline-section-empty">{t("timelineNoRelationChanges")}</p>
                    )}
                  </div>
                </ManagerSection>

                <ManagerSection
                  id="presence"
                  title={t("timelinePresence")}
                  count={presenceChanges.length}
                  description={t("timelinePresenceHelp")}
                  open={openSections.has("presence")}
                  onToggle={() => toggleSection("presence")}
                >
                  <PresenceBoard
                    nodes={lifeNodes}
                    places={places}
                    presence={presence}
                    timeline={timeline}
                    momentId={selected.id}
                    onPatch={patchPresenceAt}
                  />
                </ManagerSection>

                <ManagerSection
                  id="life"
                  title={t("timelineLife")}
                  count={lifeChanges.length}
                  description={t("timelineLifeHelp")}
                  open={openSections.has("life")}
                  onToggle={() => toggleSection("life")}
                >
                  <div className="life-event-board">
                    <div className="life-event-roster">
                      {lifeNodes.map((node) => (
                        <button
                          key={node.id}
                          draggable
                          className={selectedLifeId === node.id ? "selected" : ""}
                          aria-pressed={selectedLifeId === node.id}
                          onDragStart={(event) =>
                            event.dataTransfer.setData("application/x-quiltor-life", node.id)
                          }
                          onClick={() =>
                            setSelectedLifeId((value) => (value === node.id ? null : node.id))
                          }
                        >
                          <strong>{node.name}</strong>
                          <small>{node.type === "tier" ? t("animal") : t("figure")}</small>
                        </button>
                      ))}
                    </div>
                    <button
                      className="death-dropzone"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData("application/x-quiltor-life");
                        if (id) markDeath(id);
                      }}
                      onClick={() => selectedLifeId && markDeath(selectedLifeId)}
                    >
                      <Skull />
                      <span>
                        <strong>{t("timelineDeathHere")}</strong>
                        <small>
                          {selectedLifeId ? t("timelineDeathSelected") : t("timelineDeathHelp")}
                        </small>
                      </span>
                    </button>
                    {!!lifeChanges.length && (
                      <div className="life-change-list">
                        {lifeChanges.map((node) => (
                          <button key={node.id} onClick={() => markDeath(node.id)}>
                            <Skull />
                            <span>
                              <strong>{node.name}</strong>
                              <small>{t("removeDeathMarker")}</small>
                            </span>
                            <X />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </ManagerSection>
              </main>
              {selectedEdge && !compact && (
                <RelationshipInspector
                  edge={selectedEdge}
                  nodes={state.nodes}
                  timeline={timeline}
                  momentId={selected.id}
                  explicit={edgeChanges.includes(selectedEdge)}
                  onPatch={(patch) => patchEdge(selectedEdge, patch)}
                  onReset={() => {
                    removeEdgeChange(selectedEdge);
                    setSelectedEdgeId(null);
                  }}
                  onClose={() => setSelectedEdgeId(null)}
                  t={t}
                />
              )}
            </div>
          )}
        </>
      )}
      {selected && selectedEdge && compact && (
        <Sheet open label={t("relationship")} onClose={() => setSelectedEdgeId(null)}>
          <RelationshipInspector
            edge={selectedEdge}
            nodes={state.nodes}
            timeline={timeline}
            momentId={selected.id}
            explicit={edgeChanges.includes(selectedEdge)}
            onPatch={(patch) => patchEdge(selectedEdge, patch)}
            onReset={() => {
              removeEdgeChange(selectedEdge);
              setSelectedEdgeId(null);
            }}
            onClose={() => setSelectedEdgeId(null)}
            t={t}
          />
        </Sheet>
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
          onConfirm={() => {
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
              presence: presence.filter((entry) => entry.momentId !== deleteMoment.id),
            });
            setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id || null);
            setDeleteMoment(null);
          }}
        />
      )}
    </section>
  );
}

function calendarDayCount(system: TimeSystem, year: number, month: number): number {
  if (system.kind === "custom") return system.months[month - 1]?.dayCount || 1;
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function CalendarCoordinateInput({
  system,
  time,
  precision,
  label,
  onChange,
  language,
  t,
}: {
  system: TimeSystem;
  time: number;
  precision: NonNullable<TimelineMoment["precision"]>;
  label: string;
  onChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  language: Language;
  t: Translate;
}) {
  const coordinate = calendarCoordinate(system, time) || {
    year: system.epochYear,
    month: system.epochMonth,
    day: system.epochDay,
  };
  const apply = (
    patch: Partial<CalendarCoordinate>,
    nextPrecision: NonNullable<TimelineMoment["precision"]> = precision,
  ) => {
    const next = { ...coordinate, ...patch };
    const maxDay = calendarDayCount(system, next.year, next.month);
    next.day = Math.min(Math.max(next.day, 1), maxDay);
    const nextTime = timeFromCalendarCoordinate(system, next);
    if (nextTime !== null) onChange(nextTime, nextPrecision);
  };
  const monthOptions =
    system.kind === "custom"
      ? system.months.map((month, index) => ({ value: index + 1, label: month.name }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: gregorianMonthLabel(language, index + 1),
        }));
  return (
    <fieldset className="timeline-calendar-date">
      <legend>{label}</legend>
      <label>
        <span>{t("timelineDay")}</span>
        <select
          disabled={precision === "year"}
          value={precision === "day" ? coordinate.day : ""}
          onChange={(event) =>
            event.target.value
              ? apply({ day: Number(event.target.value) }, "day")
              : apply({ day: 1 }, "month")
          }
        >
          <option value="">{t("timelineUnknown")}</option>
          {Array.from(
            { length: calendarDayCount(system, coordinate.year, coordinate.month) },
            (_, index) => (
              <option value={index + 1} key={index + 1}>
                {index + 1}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <span>{t("timelineMonth")}</span>
        <select
          value={precision === "year" ? "" : coordinate.month}
          onChange={(event) =>
            event.target.value
              ? apply({ month: Number(event.target.value), day: 1 }, "month")
              : apply({ month: 1, day: 1 }, "year")
          }
        >
          <option value="">{t("timelineUnknown")}</option>
          {monthOptions.map((month) => (
            <option value={month.value} key={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("timelineYear")}</span>
        <input
          type="number"
          value={coordinate.year}
          min={system.kind === "gregorian" ? 1 : -Number.MAX_SAFE_INTEGER}
          max={system.kind === "gregorian" ? 9999 : Number.MAX_SAFE_INTEGER}
          onChange={(event) => apply({ year: Math.trunc(Number(event.target.value) || 1) })}
        />
      </label>
    </fieldset>
  );
}

function RelativeMomentFields({
  system,
  timeline,
  selected,
  amount,
  direction,
  baseId,
  onChange,
  t,
}: {
  system: TimeSystem;
  timeline: TimelineMoment[];
  selected: TimelineMoment;
  amount: number;
  direction: "before" | "after";
  baseId: string;
  onChange: (amount: number, direction: "before" | "after", baseId: string) => void;
  t: Translate;
}) {
  const candidates = timeline.filter((moment) => moment.id !== selected.id);
  const effectiveBaseId = candidates.some((moment) => moment.id === baseId)
    ? baseId
    : candidates[0]?.id || "";
  const distanceLabel =
    system.unit === "day" ? t("timelineDistanceDays") : t("timelineDistanceSteps");
  return (
    <fieldset className="timeline-relative-position">
      <legend>{t("timelineRelativePlacement")}</legend>
      <p>{t("timelineRelativePlacementHelp")}</p>
      <label>
        <span>{t("timelineBaseMoment")}</span>
        <select
          value={effectiveBaseId}
          onChange={(event) => onChange(amount, direction, event.target.value)}
        >
          {candidates.map((moment) => (
            <option key={moment.id} value={moment.id}>
              {moment.title ||
                t("timelinePoint", {
                  number: timeline.findIndex((item) => item.id === moment.id) + 1,
                })}
              {" · "}
              {momentTimeLabel(system, moment, timeline.indexOf(moment), t)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("timelineDirection")}</span>
        <select
          value={direction}
          onChange={(event) =>
            onChange(amount, event.target.value as "before" | "after", effectiveBaseId)
          }
        >
          <option value="before">{t("timelineBefore")}</option>
          <option value="after">{t("timelineAfter")}</option>
        </select>
      </label>
      <label>
        <span>{distanceLabel}</span>
        <input
          type="number"
          min="0"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          value={amount}
          onChange={(event) =>
            onChange(
              Math.max(0, Math.trunc(Number(event.target.value) || 0)),
              direction,
              effectiveBaseId,
            )
          }
        />
      </label>
    </fieldset>
  );
}

function MomentCalendarFields({
  system,
  moment,
  fallback,
  onStartChange,
  onEndChange,
  onClearEnd,
  language,
  t,
}: {
  system: TimeSystem;
  moment: TimelineMoment;
  fallback: number;
  onStartChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onEndChange: (time: number, precision: NonNullable<TimelineMoment["precision"]>) => void;
  onClearEnd: () => void;
  language: Language;
  t: Translate;
}) {
  const startTime = timeOfMoment(moment, fallback);
  const precision = moment.precision || "day";
  return (
    <div className="timeline-calendar-range">
      <CalendarCoordinateInput
        system={system}
        time={startTime}
        precision={precision}
        label={
          Number.isSafeInteger(moment.endTime) ? t("timelineDateStart") : t("timelineDateSingle")
        }
        onChange={onStartChange}
        language={language}
        t={t}
      />
      {Number.isSafeInteger(moment.endTime) ? (
        <div className="timeline-calendar-end">
          <CalendarCoordinateInput
            system={system}
            time={moment.endTime as number}
            precision={moment.endPrecision || precision}
            label={t("timelineDateEnd")}
            onChange={(time, endPrecision) => onEndChange(Math.max(time, startTime), endPrecision)}
            language={language}
            t={t}
          />
          <button type="button" className="timeline-inline-remove" onClick={onClearEnd}>
            <X />
            {t("timelineRemoveEnd")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="timeline-inline-add"
          onClick={() => onEndChange(startTime, precision)}
        >
          <Plus />
          {t("timelineAddEnd")}
        </button>
      )}
    </div>
  );
}

function AnchorDateFields({
  system,
  onPatch,
  language,
  t,
}: {
  system: TimeSystem;
  onPatch: (patch: Partial<TimeSystem>) => void;
  language: Language;
  t: Translate;
}) {
  const monthOptions =
    system.kind === "custom"
      ? system.months.map((month, index) => ({ value: index + 1, label: month.name }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: gregorianMonthLabel(language, index + 1),
        }));
  const patchDate = (patch: Partial<CalendarCoordinate>) => {
    const next = {
      year: patch.year ?? system.epochYear,
      month: patch.month ?? system.epochMonth,
      day: patch.day ?? system.epochDay,
    };
    next.month = Math.min(Math.max(next.month, 1), Math.max(monthOptions.length, 1));
    next.day = Math.min(Math.max(next.day, 1), calendarDayCount(system, next.year, next.month));
    onPatch({ epochYear: next.year, epochMonth: next.month, epochDay: next.day });
  };
  return (
    <fieldset className="timeline-calendar-date timeline-anchor-date">
      <legend>{t("timelineAnchorDate")}</legend>
      <label>
        <span>{t("timelineDay")}</span>
        <select
          value={Math.min(
            system.epochDay,
            calendarDayCount(system, system.epochYear, system.epochMonth),
          )}
          onChange={(event) => patchDate({ day: Number(event.target.value) })}
        >
          {Array.from(
            {
              length: calendarDayCount(system, system.epochYear, system.epochMonth),
            },
            (_, index) => (
              <option value={index + 1} key={index + 1}>
                {index + 1}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <span>{t("timelineMonth")}</span>
        <select
          value={Math.min(system.epochMonth, Math.max(monthOptions.length, 1))}
          onChange={(event) => patchDate({ month: Number(event.target.value) })}
        >
          {monthOptions.map((month) => (
            <option value={month.value} key={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("timelineYear")}</span>
        <input
          type="number"
          value={system.epochYear}
          min={system.kind === "gregorian" ? 1 : -Number.MAX_SAFE_INTEGER}
          max={system.kind === "gregorian" ? 9999 : Number.MAX_SAFE_INTEGER}
          onChange={(event) => patchDate({ year: Math.trunc(Number(event.target.value) || 1) })}
        />
      </label>
    </fieldset>
  );
}

function TimeSystemControls({
  system,
  onKindChange,
  onPatch,
  language,
  t,
}: {
  system: TimeSystem;
  onKindChange: (value: TimeSystemKind) => void;
  onPatch: (patch: Partial<TimeSystem>) => void;
  language: Language;
  t: Translate;
}) {
  const [monthCount, setMonthCount] = useState(1);
  const [weekdayCount, setWeekdayCount] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const patchMonth = (index: number, patch: Partial<TimeSystem["months"][number]>) =>
    onPatch({
      months: system.months.map((month, position) =>
        position === index ? { ...month, ...patch } : month,
      ),
    });
  const addMonths = () => {
    const count = Math.min(100, Math.max(1, Math.trunc(monthCount) || 1));
    onPatch({
      months: [
        ...system.months,
        ...Array.from({ length: count }, (_, offset) => {
          const number = system.months.length + offset + 1;
          return {
            name: t("timelineMonthDefault", { number }),
            shortName: `M${number}`,
            dayCount: 30,
          };
        }),
      ],
    });
  };
  const addWeekdays = () => {
    const count = Math.min(100, Math.max(1, Math.trunc(weekdayCount) || 1));
    onPatch({
      weekdays: [
        ...system.weekdays,
        ...Array.from({ length: count }, (_, offset) => {
          const number = system.weekdays.length + offset + 1;
          return {
            name: t("timelineWeekdayDefault", { number }),
            shortName: t("timelineWeekdayShortDefault", { number }),
          };
        }),
      ],
    });
  };

  return (
    <div className="timeline-time-controls">
      <label>
        <span className="sr-only">{t("timelineTimeSystem")}</span>
        <select
          aria-label={t("timelineTimeSystem")}
          value={system.kind}
          onChange={(event) => onKindChange(event.target.value as TimeSystemKind)}
        >
          <option value="relative">{t("timelineTimeRelative")}</option>
          <option value="gregorian">{t("timelineTimeGregorian")}</option>
          {system.kind === "custom" && (
            <option value="custom">{system.name || t("timelineTimeCustom")}</option>
          )}
        </select>
      </label>
      <details
        className="timeline-time-settings"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary aria-expanded={settingsOpen}>
          <Settings2 aria-hidden="true" />
          <span>{t("timelineConfigureTime")}</span>
        </summary>
        <div className="timeline-time-settings-panel">
          {system.kind === "custom" && (
            <label>
              <span>{t("timelineCalendarName")}</span>
              <input
                value={system.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
          )}
          {system.kind === "relative" ? (
            <label>
              <span>{t("timelineUnit")}</span>
              <select
                value={system.unit}
                onChange={(event) => onPatch({ unit: event.target.value as TimeSystem["unit"] })}
              >
                <option value="day">{t("timelineDays")}</option>
                <option value="abstract">{t("timelineAbstract")}</option>
              </select>
            </label>
          ) : (
            <>
              <AnchorDateFields system={system} onPatch={onPatch} language={language} t={t} />
              <label>
                <span>{t("timelineEra")}</span>
                <input
                  value={system.eraName}
                  onChange={(event) => onPatch({ eraName: event.target.value })}
                />
              </label>
              <label>
                <span>{t("timelineEraAbbreviation")}</span>
                <input
                  value={system.eraAbbreviation}
                  onChange={(event) => onPatch({ eraAbbreviation: event.target.value })}
                />
              </label>
              <label>
                <span>{t("timelineDisplayFormat")}</span>
                <select
                  value={system.displayFormat || defaultDisplayFormat(system.kind)}
                  onChange={(event) => onPatch({ displayFormat: event.target.value })}
                >
                  <option
                    value={
                      system.kind === "custom"
                        ? "{day} {monthName}, {year} {era}"
                        : "{day:02d}.{month:02d}.{year:04d} {era}"
                    }
                  >
                    {t("timelineFormatDayMonthYear")}
                  </option>
                  <option
                    value={
                      system.kind === "custom"
                        ? "{monthName} {day}, {year} {era}"
                        : "{month:02d}/{day:02d}/{year:04d} {era}"
                    }
                  >
                    {t("timelineFormatMonthDayYear")}
                  </option>
                  <option
                    value={
                      system.kind === "custom"
                        ? "{year} {monthName} {day} {era}"
                        : "{year:04d}-{month:02d}-{day:02d} {era}"
                    }
                  >
                    {t("timelineFormatYearMonthDay")}
                  </option>
                </select>
              </label>
            </>
          )}
          {system.kind === "custom" && (
            <div className="timeline-calendar-structure">
              <fieldset>
                <legend>{t("timelineWeekdays")}</legend>
                {!!system.weekdays.length && (
                  <div className="timeline-calendar-item-head" aria-hidden="true">
                    <span>{t("name")}</span>
                    <span>{t("timelineAbbreviation")}</span>
                    <span />
                  </div>
                )}
                {system.weekdays.map((weekday, index) => (
                  <div className="timeline-calendar-item" key={`weekday-${index}`}>
                    <input
                      aria-label={t("timelineWeekdayName", { number: index + 1 })}
                      value={weekday.name}
                      onChange={(event) =>
                        onPatch({
                          weekdays: system.weekdays.map((item, position) =>
                            position === index ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={t("timelineWeekdayShortName", { name: weekday.name })}
                      value={weekday.shortName}
                      onChange={(event) =>
                        onPatch({
                          weekdays: system.weekdays.map((item, position) =>
                            position === index ? { ...item, shortName: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("timelineRemoveWeekday", { name: weekday.name })}
                      onClick={() =>
                        onPatch({
                          weekdays: system.weekdays.filter((_, position) => position !== index),
                          epochWeekday: Math.min(
                            system.epochWeekday,
                            Math.max(system.weekdays.length - 2, 0),
                          ),
                        })
                      }
                    >
                      <X />
                    </button>
                  </div>
                ))}
                <div className="timeline-calendar-add-row">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    aria-label={t("timelineWeekdayCount")}
                    value={weekdayCount}
                    onChange={(event) => setWeekdayCount(Number(event.target.value))}
                  />
                  <button type="button" onClick={addWeekdays}>
                    <Plus />
                    {t("timelineAddWeekdays")}
                  </button>
                </div>
              </fieldset>
              {!!system.weekdays.length && (
                <label>
                  <span>{t("timelineEpochWeekday")}</span>
                  <select
                    value={system.epochWeekday}
                    onChange={(event) => onPatch({ epochWeekday: Number(event.target.value) })}
                  >
                    {system.weekdays.map((weekday, index) => (
                      <option key={`${weekday.name}-${index}`} value={index}>
                        {weekday.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <fieldset>
                <legend>{t("timelineMonths")}</legend>
                <div className="timeline-calendar-item-head" aria-hidden="true">
                  <span>{t("name")}</span>
                  <span>{t("timelineDays")}</span>
                  <span />
                </div>
                {system.months.map((month, index) => (
                  <div className="timeline-calendar-item" key={`month-${index}`}>
                    <input
                      aria-label={t("timelineMonthName", { number: index + 1 })}
                      value={month.name}
                      onChange={(event) => patchMonth(index, { name: event.target.value })}
                    />
                    <input
                      aria-label={t("timelineMonthDays", { name: month.name })}
                      type="number"
                      min="1"
                      step="1"
                      value={month.dayCount}
                      onChange={(event) =>
                        patchMonth(index, {
                          dayCount: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={system.months.length === 1}
                      aria-label={t("timelineRemoveMonth", { name: month.name })}
                      onClick={() =>
                        onPatch({
                          months: system.months.filter((_, position) => position !== index),
                          epochMonth: Math.min(system.epochMonth, system.months.length - 1),
                        })
                      }
                    >
                      <X />
                    </button>
                  </div>
                ))}
                <div className="timeline-calendar-add-row">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    aria-label={t("timelineMonthCount")}
                    value={monthCount}
                    onChange={(event) => setMonthCount(Number(event.target.value))}
                  />
                  <button type="button" onClick={addMonths}>
                    <Plus />
                    {t("timelineAddMonths")}
                  </button>
                </div>
              </fieldset>
            </div>
          )}
        </div>
      </details>
      <button
        type="button"
        className="primary timeline-add-calendar"
        onClick={() => {
          if (system.kind !== "custom") onKindChange("custom");
          setSettingsOpen(true);
        }}
      >
        <Plus />
        {t("timelineAddCustomCalendar")}
      </button>
    </div>
  );
}

function ManagerSection({
  id,
  title,
  description,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const panelId = `timeline-section-${id}`;
  return (
    <section className={`timeline-manager-section ${open ? "open" : ""}`}>
      <header>
        <button
          className="timeline-section-toggle"
          aria-label={title}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span className="timeline-section-summary">
            <span className="section-count">{count}</span>
            <ChevronDown />
          </span>
        </button>
      </header>
      {open && (
        <div id={panelId} className="timeline-section-body">
          {children}
        </div>
      )}
    </section>
  );
}

function RelationshipCard({
  edge,
  nodes,
  timeline,
  momentId,
  explicit,
  selected,
  onSelect,
  t,
}: {
  edge: FigureEdge;
  nodes: FigureNode[];
  timeline: TimelineMoment[];
  momentId: string;
  explicit: boolean;
  selected: boolean;
  onSelect: () => void;
  t: Translate;
}) {
  const current = resolveRelationship(edge, timeline, momentId);
  const index = timeline.findIndex((moment) => moment.id === momentId);
  const before =
    index > 0
      ? resolveRelationship(edge, timeline, timeline[index - 1].id)
      : { ...edge, active: edge.active !== false };
  const from = nodes.find((node) => node.id === current.from),
    to = nodes.find((node) => node.id === current.to);
  const changedLabel = explicit && before.label !== current.label;
  return (
    <button
      className={`relationship-change-card ${selected ? "selected" : ""} ${!current.active ? "inactive" : ""}`}
      onClick={onSelect}
    >
      <div className="relationship-card-main">
        <span className="change-badge">
          {explicit
            ? current.active
              ? t("timelineChange")
              : t("timelineEndsHere")
            : t("timelineInheritedBadge")}
        </span>
        <strong>
          {from?.name || t("unknown")} <i>{current.gerichtet ? "→" : "↔"}</i>{" "}
          {to?.name || t("unknown")}
        </strong>
        <small>
          {changedLabel
            ? t("timelineChangedLabel", {
                before: before.label || t("timelineNoLabel"),
                after: current.label || t("timelineNoLabel"),
              })
            : current.label || t("timelineWithoutLabel")}
        </small>
      </div>
      <ChevronRight />
    </button>
  );
}

function RelationshipInspector({
  edge,
  nodes,
  timeline,
  momentId,
  explicit,
  onPatch,
  onReset,
  onClose,
  t,
}: {
  edge: FigureEdge;
  nodes: FigureNode[];
  timeline: TimelineMoment[];
  momentId: string;
  explicit: boolean;
  onPatch: (patch: Partial<FigureEdge>) => void;
  onReset: () => void;
  onClose: () => void;
  t: Translate;
}) {
  const resolved = resolveRelationship(edge, timeline, momentId);
  const labelEditor = relationshipLabelEditor(edge, timeline, momentId);
  const from = nodes.find((node) => node.id === resolved.from),
    to = nodes.find((node) => node.id === resolved.to);
  return (
    <aside className="storyboard-inspector" aria-label={t("relationship")}>
      <header>
        <div>
          <span>{t("relationship")}</span>
          <strong>
            {from?.name || t("unknown")} {resolved.gerichtet ? "→" : "↔"} {to?.name || t("unknown")}
          </strong>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t("timelineCloseRelation")}>
          <X />
        </button>
      </header>
      <div className="panel-body">
        <label className="field">
          <span>{t("timelineLabelFromHere")}</span>
          <input
            value={labelEditor.value}
            placeholder={
              labelEditor.inherited
                ? t("timelineInherited", { value: labelEditor.inherited })
                : t("relationship")
            }
            disabled={!resolved.active}
            onChange={(event) => onPatch({ label: event.target.value })}
          />
        </label>
        <div className="relationship-inspector-actions">
          <button
            aria-pressed={resolved.active}
            onClick={() => onPatch({ active: !resolved.active })}
          >
            {resolved.active ? t("timelineAppliesHere") : t("timelineEndsHere")}
          </button>
          <button
            aria-pressed={!!resolved.gerichtet}
            disabled={!resolved.active}
            onClick={() => onPatch({ gerichtet: !resolved.gerichtet })}
          >
            {resolved.gerichtet ? t("directed") : t("undirected")}
          </button>
          <button
            disabled={!resolved.active || !resolved.gerichtet}
            onClick={() => onPatch({ from: resolved.to, to: resolved.from })}
          >
            <ArrowLeftRight />
            {t("reverseDirection")}
          </button>
        </div>
        {explicit ? (
          <button className="secondary-action reset-inheritance" onClick={onReset}>
            <Undo2 />
            {t("timelineRemoveOwn")}
            <small>{t("timelineInheritPrevious")}</small>
          </button>
        ) : (
          <p className="inherited-note">{t("timelineInheritedHelp")}</p>
        )}
      </div>
    </aside>
  );
}

function relationshipName(
  edge: FigureEdge,
  nodes: FigureNode[],
  timeline: TimelineMoment[],
  momentId: string,
  t: Translate,
) {
  const current = resolveRelationship(edge, timeline, momentId),
    from = nodes.find((node) => node.id === current.from),
    to = nodes.find((node) => node.id === current.to);
  return `${from?.name || t("unknown")} ${current.gerichtet ? "→" : "↔"} ${to?.name || t("unknown")} · ${current.label || t("timelineNoLabel")}`;
}

function countMomentChanges(state: FigureState, momentId: string) {
  return (
    state.edges.filter((edge) => edge.versions?.some((version) => version.momentId === momentId))
      .length +
    state.nodes.filter((node) => node.diedMomentId === momentId).length +
    (state.presence || []).filter((entry) => entry.momentId === momentId).length
  );
}
