import { ArrowLeftRight, ChevronDown, ChevronRight, Skull, Undo2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button, IconButton, SegmentedControl, Select, Sheet, TextField } from "../../../design";
import type { Translate } from "../../../i18n";
import { patchPresence } from "../figures/presence";
import {
  patchRelationship,
  relationshipLabelEditor,
  resolveRelationship,
} from "../figures/relationships";
import type { FigureEdge, FigureNode, FigureState, TimelineMoment } from "../model";
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the active moment intentionally closes its relationship inspector.
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
              <SegmentedControl<BoardMode>
                className="storyboard-mode"
                label={t("timelineView")}
                value={mode}
                options={[
                  { value: "changes", label: t("timelineOnlyChanges") },
                  { value: "state", label: t("timelineWholeState") },
                ]}
                onChange={setMode}
                size="compact"
              />
            </div>
            <div className="relationship-add">
              <Select
                className="relationship-add-select"
                label={t("timelineChangeRelation")}
                labelHidden
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
              </Select>
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
                  <Button
                    key={node.id}
                    draggable
                    className={`life-event-person ${selectedLifeId === node.id ? "selected" : ""}`}
                    aria-pressed={selectedLifeId === node.id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("application/x-quiltor-life", node.id)
                    }
                    onClick={() =>
                      setSelectedLifeId((value) => (value === node.id ? null : node.id))
                    }
                  >
                    <span className="life-event-person-copy">
                      <strong>{node.name}</strong>
                      <small>{node.type === "tier" ? t("animal") : t("figure")}</small>
                    </span>
                  </Button>
                ))}
              </div>
              <Button
                className="death-dropzone"
                appearance="secondary"
                tone="danger"
                icon={<Skull />}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData("application/x-quiltor-life");
                  if (id) markDeath(id);
                }}
                onClick={() => selectedLifeId && markDeath(selectedLifeId)}
              >
                <span className="death-dropzone-copy">
                  <strong>{t("timelineDeathHere")}</strong>
                  <small>
                    {selectedLifeId ? t("timelineDeathSelected") : t("timelineDeathHelp")}
                  </small>
                </span>
              </Button>
              {!!lifeChanges.length && (
                <div className="life-change-list">
                  {lifeChanges.map((node) => (
                    <Button
                      key={node.id}
                      className="life-change-action"
                      icon={<Skull />}
                      onClick={() => markDeath(node.id)}
                    >
                      <span className="life-change-content">
                        <span className="life-change-copy">
                          <strong>{node.name}</strong>
                          <small>{t("removeDeathMarker")}</small>
                        </span>
                        <X />
                      </span>
                    </Button>
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
        <Button
          appearance="ghost"
          className="timeline-section-toggle"
          aria-label={title}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          icon={<ChevronDown className="timeline-section-chevron" />}
          iconPosition="end"
        >
          <span className="timeline-section-content">
            <span className="timeline-section-heading">
              <h2>{title}</h2>
              <p>{description}</p>
            </span>
            <span className="section-count">{count}</span>
          </span>
        </Button>
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
    <Button
      appearance="secondary"
      className={`relationship-change-card ${selected ? "selected" : ""} ${!current.active ? "inactive" : ""}`}
      onClick={onSelect}
      icon={<ChevronRight />}
      iconPosition="end"
    >
      <span className="relationship-card-main">
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
      </span>
    </Button>
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
        <IconButton label={t("timelineCloseRelation")} icon={<X />} onClick={onClose} />
      </header>
      <div className="storyboard-inspector-body">
        <TextField
          fieldClassName="relationship-label-field"
          label={t("timelineLabelFromHere")}
          value={labelEditor.value}
          placeholder={
            labelEditor.inherited
              ? t("timelineInherited", { value: labelEditor.inherited })
              : t("relationship")
          }
          disabled={!resolved.active}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
        <div className="relationship-inspector-actions">
          <Button
            className="relationship-inspector-action"
            aria-pressed={resolved.active}
            onClick={() => onPatch({ active: !resolved.active })}
          >
            {resolved.active ? t("timelineAppliesHere") : t("timelineEndsHere")}
          </Button>
          <Button
            className="relationship-inspector-action"
            aria-pressed={!!resolved.gerichtet}
            disabled={!resolved.active}
            onClick={() => onPatch({ gerichtet: !resolved.gerichtet })}
          >
            {resolved.gerichtet ? t("directed") : t("undirected")}
          </Button>
          <Button
            className="relationship-inspector-action"
            disabled={!resolved.active || !resolved.gerichtet}
            onClick={() => onPatch({ from: resolved.to, to: resolved.from })}
            icon={<ArrowLeftRight />}
          >
            {t("reverseDirection")}
          </Button>
        </div>
        {explicit ? (
          <Button className="reset-inheritance" onClick={onReset} icon={<Undo2 />}>
            <span className="reset-inheritance-copy">
              <span>{t("timelineRemoveOwn")}</span>
              <small>{t("timelineInheritPrevious")}</small>
            </span>
          </Button>
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
