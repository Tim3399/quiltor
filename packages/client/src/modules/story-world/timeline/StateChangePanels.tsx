import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, Skull, Undo2, X } from "lucide-react";
import type { FigureEdge, FigureNode, FigureState, TimelineMoment } from "../model";
import type { Translate } from "../../../i18n";
import { Sheet } from "../../../shared/ui/Sheet";
import {
  patchRelationship,
  relationshipLabelEditor,
  resolveRelationship,
} from "../figures/relationships";
import { patchPresence } from "../figures/presence";
import { PresenceBoard } from "./PresenceBoard";
import "./StateChangePanels.css";

type BoardMode = "changes" | "state";

export function MomentStateWorkspace({
  state,
  onChange,
  moment,
  editor,
  t,
}: {
  state: FigureState;
  onChange: (value: FigureState) => void;
  moment: TimelineMoment;
  editor: ReactNode;
  t: Translate;
}) {
  const timeline = state.timeline || [];
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>("changes");
  const [openSections, setOpenSections] = useState(() => new Set(["relationships"]));
  const [selectedLifeId, setSelectedLifeId] = useState<string | null>(null);
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  useEffect(() => setSelectedEdgeId(null), [moment.id]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 719px)"),
      update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const lifeNodes = useMemo(
    () => state.nodes.filter((node) => node.type === "person" || node.type === "tier"),
    [state.nodes],
  );
  const places = useMemo(() => state.nodes.filter((node) => node.type === "ort"), [state.nodes]);
  const presence = state.presence ?? [];
  const edgeChanges = state.edges.filter((edge) =>
    edge.versions?.some((version) => version.momentId === moment.id),
  );
  const presenceChanges = presence.filter((entry) => entry.momentId === moment.id);
  const lifeChanges = lifeNodes.filter((node) => node.diedMomentId === moment.id);
  const visibleEdges = mode === "changes" ? edgeChanges : state.edges;
  const selectedEdge = state.edges.find((edge) => edge.id === selectedEdgeId) || null;

  const patchEdge = (edge: FigureEdge, patch: Partial<FigureEdge>) =>
    onChange({
      ...state,
      edges: state.edges.map((item) =>
        item.id === edge.id ? patchRelationship(item, timeline, moment.id, patch) : item,
      ),
    });
  const removeEdgeChange = (edge: FigureEdge) =>
    onChange({
      ...state,
      edges: state.edges.map((item) =>
        item.id === edge.id
          ? {
              ...item,
              versions: item.versions?.filter((version) => version.momentId !== moment.id),
            }
          : item,
      ),
    });
  const addRelationshipChange = (edgeId: string) => {
    const edge = state.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    patchEdge(edge, {});
    setSelectedEdgeId(edge.id);
  };
  const markDeath = (nodeId: string) => {
    onChange({
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, diedMomentId: node.diedMomentId === moment.id ? undefined : moment.id }
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
  const closeInspector = () => setSelectedEdgeId(null);
  const inspector = selectedEdge && (
    <RelationshipInspector
      edge={selectedEdge}
      nodes={state.nodes}
      timeline={timeline}
      momentId={moment.id}
      explicit={edgeChanges.includes(selectedEdge)}
      onPatch={(patch) => patchEdge(selectedEdge, patch)}
      onReset={() => {
        removeEdgeChange(selectedEdge);
        closeInspector();
      }}
      onClose={closeInspector}
      t={t}
    />
  );

  return (
    <>
      <div className={`storyboard-layout ${selectedEdge ? "has-inspector" : ""}`}>
        <main className="storyboard-main">
          {editor}
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
                        {relationshipName(edge, state.nodes, timeline, moment.id, t)}
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
                  momentId={moment.id}
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
              momentId={moment.id}
              onPatch={(nodeId, placeId) =>
                onChange({
                  ...state,
                  presence: patchPresence(presence, nodeId, moment.id, placeId || null),
                })
              }
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
        {selectedEdge && !compact && inspector}
      </div>
      {selectedEdge && compact && (
        <Sheet open label={t("relationship")} onClose={closeInspector}>
          {inspector}
        </Sheet>
      )}
    </>
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
  children: ReactNode;
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
