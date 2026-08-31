import { Panel, ReactFlowProvider } from "@xyflow/react";
import { UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Checkbox,
  ConfirmDialog,
  IconButton,
  SidePanel,
  SidePanelEmpty,
  SidePanelHeader,
  Toast,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import { GraphEdgeInspector, graphEdgeLineStyle, graphRelationshipKind } from "../../graph";
import type { FigureEdge, FigureNode, FigureState, PresenceEntry, TimelineMoment } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { insertTimelineMoment, removeTimelineMoment } from "../timeline/order";
import { FigureCanvas } from "./FigureCanvas";
import { FigureInspector } from "./FigureInspector";
import { FigureNodeContextMenu, type FigureNodeMenuState } from "./FigureNodeContextMenu";
import { FigureToolbar } from "./FigureToolbar";
import { prunePresence } from "./presence";
import {
  patchRelationship,
  relationshipConflicts,
  relationshipLabelEditor,
  resolveRelationship,
} from "./relationships";
import { TimelineStrip } from "./TimelineStrip";
import { useFigureCanvas } from "./useFigureCanvas";

const EMPTY_TIMELINE: TimelineMoment[] = [];
const EMPTY_PRESENCE: PresenceEntry[] = [];

export type FigureWorkspaceProps = {
  state: FigureState;
  onChange: (value: FigureState) => void;
  targetId?: string;
  targetRequestId?: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

export function FigureWorkspace(props: FigureWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <FigureWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}

function FigureWorkspaceInner({
  state,
  onChange,
  targetId,
  targetRequestId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: FigureWorkspaceProps) {
  const { locale, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [relationshipsVisible, setRelationshipsVisible] = useState(true);
  const [nodeMenu, setNodeMenu] = useState<FigureNodeMenuState | null>(null);
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(() => !!state.timeline?.length);
  const [journeyOverlayOpen, setJourneyOverlayOpen] = useState(() => !!state.presence?.length);
  const [playing, setPlaying] = useState(false);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const latestState = useRef(state);
  latestState.current = state;

  const selected = state.nodes.find((node) => node.id === selectedId) ?? null;
  const timeline = state.timeline ?? EMPTY_TIMELINE;
  const presence = state.presence ?? EMPTY_PRESENCE;
  const selectedEdge = state.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const resolvedSelectedEdge = selectedEdge
    ? resolveRelationship(selectedEdge, timeline, activeMomentId)
    : null;
  const visibleSelectedEdge = resolvedSelectedEdge?.active ? resolvedSelectedEdge : null;
  const selectedEdgeLabel = selectedEdge
    ? relationshipLabelEditor(selectedEdge, timeline, activeMomentId)
    : null;
  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
  }, []);
  const closeNodeMenu = useCallback(() => setNodeMenu(null), []);
  const canvas = useFigureCanvas({
    state,
    onChange,
    selected,
    timeline,
    presence,
    activeMomentId,
    journeyOverlayOpen,
    relationshipsVisible,
    selectedEdgeId,
    onSelectNode: selectNode,
    onSelectEdge: setSelectedEdgeId,
    onStopConnecting: () => setConnecting(false),
    onEnsureRelationshipsVisible: () => setRelationshipsVisible(true),
    onConnectionError: setConnectionError,
  });
  const centerOnNode = useRef(canvas.centerOnNode);
  centerOnNode.current = canvas.centerOnNode;

  useEffect(() => {
    const closeModes = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConnecting(false);
      setNodeMenu(null);
      setSelectedEdgeId(null);
    };
    document.addEventListener("keydown", closeModes);
    return () => document.removeEventListener("keydown", closeModes);
  }, []);
  useEffect(() => {
    // The ID is an event identity: a newer request must replay selection even when its target is
    // textually identical to the previous request.
    void targetRequestId;
    if (!targetId) return;
    const current = latestState.current;
    const item = current.nodes.find((node) => node.id === targetId);
    if (item) {
      setSelectedId(targetId);
      setSelectedEdgeId(null);
      centerOnNode.current(item);
      return;
    }
    if ((current.timeline ?? EMPTY_TIMELINE).some((moment) => moment.id === targetId)) {
      setActiveMomentId(targetId);
      setTimelineOpen(true);
    }
  }, [targetId, targetRequestId]);
  useEffect(() => {
    if (!playing || !timeline.length) return;
    const index = activeMomentId
      ? timeline.findIndex((moment) => moment.id === activeMomentId)
      : -1;
    if (index >= timeline.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setActiveMomentId(timeline[index + 1].id), 1500);
    return () => window.clearTimeout(timer);
  }, [playing, activeMomentId, timeline]);

  const patchNode = (id: string, patch: Partial<FigureNode>) =>
    onChange({
      ...state,
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  const patchSelectedEdge = (patch: Partial<FigureEdge>) => {
    if (!selectedEdge) return;
    const current = latestState.current;
    const next = {
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === selectedEdge.id
          ? patchRelationship(edge, current.timeline ?? EMPTY_TIMELINE, activeMomentId, patch)
          : edge,
      ),
    };
    latestState.current = next;
    onChange(next);
  };
  const edgeConflict = (
    edge: FigureEdge & { active: boolean },
    patch: Pick<FigureEdge, "from" | "to" | "gerichtet">,
  ) => relationshipConflicts(state.edges, timeline, activeMomentId, edge.id, patch);
  const toggleEdgeConflict = visibleSelectedEdge
    ? edgeConflict(visibleSelectedEdge, {
        from: visibleSelectedEdge.from,
        to: visibleSelectedEdge.to,
        gerichtet: !visibleSelectedEdge.gerichtet,
      })
    : false;
  const reverseEdgeConflict = visibleSelectedEdge?.gerichtet
    ? edgeConflict(visibleSelectedEdge, {
        from: visibleSelectedEdge.to,
        to: visibleSelectedEdge.from,
        gerichtet: true,
      })
    : false;
  const removeSelected = () => {
    if (!selected) return;
    const remainingNodes = state.nodes.filter((node) => node.id !== selected.id);
    onChange({
      ...state,
      nodes: remainingNodes,
      edges: state.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id),
      presence: prunePresence(presence, remainingNodes, timeline),
    });
    setSelectedId(null);
  };

  return (
    <section className="figure-workspace" aria-label={t("figuresAndRelationsLabel")}>
      <FigureToolbar
        state={state}
        connecting={connecting}
        snapToGrid={canvas.snapToGrid}
        relationshipsVisible={relationshipsVisible}
        timelineOpen={timelineOpen}
        journeyOverlayOpen={journeyOverlayOpen}
        canUndo={canUndo}
        canRedo={canRedo}
        onAddNode={canvas.addNode}
        onConnectingChange={setConnecting}
        onSnapToGridChange={canvas.setSnapToGrid}
        onAlignAllNodes={canvas.alignAllNodes}
        onRelationshipsVisibleChange={(visible) => {
          setRelationshipsVisible(visible);
          if (!visible) setSelectedEdgeId(null);
        }}
        onTimelineOpenChange={setTimelineOpen}
        onJourneyOverlayOpenChange={setJourneyOverlayOpen}
        onUndo={onUndo}
        onRedo={onRedo}
        onImport={(imported) => {
          onChange(imported);
          setSelectedId(null);
          setSelectedEdgeId(null);
        }}
      />
      <div className="figure-layout">
        <FigureCanvas
          controller={canvas}
          connecting={connecting}
          playing={playing}
          onCancelConnecting={() => setConnecting(false)}
          onSelectNode={selectNode}
          onSelectEdge={(id) => {
            if (state.edges.some((edge) => edge.id === id)) setSelectedEdgeId(id);
          }}
          onOpenNodeMenu={(node, x, y, trigger) => {
            selectNode(node.id);
            setNodeMenu({ id: node.id, x, y, trigger });
          }}
          onClearSelection={() => {
            setSelectedId(null);
            setSelectedEdgeId(null);
            setNodeMenu(null);
          }}
          edgeInspector={
            selectedEdge && visibleSelectedEdge && selectedEdgeLabel ? (
              <Panel position="top-right" className="graph-edge-inspector-panel">
                <GraphEdgeInspector
                  sourceLabel={
                    state.nodes.find((node) => node.id === visibleSelectedEdge.from)?.name ??
                    t("unknown")
                  }
                  targetLabel={
                    state.nodes.find((node) => node.id === visibleSelectedEdge.to)?.name ??
                    t("unknown")
                  }
                  value={selectedEdgeLabel.value}
                  directed={!!visibleSelectedEdge.gerichtet}
                  lineStyle={graphEdgeLineStyle(visibleSelectedEdge)}
                  color={
                    visibleSelectedEdge.color ??
                    (visibleSelectedEdge.style === "gold" ? "gold" : "auto")
                  }
                  semanticControls={
                    <Checkbox
                      containerClassName="graph-edge-inspector__kinship"
                      label={t("kinship")}
                      hint={t("kinshipHint")}
                      checked={graphRelationshipKind(visibleSelectedEdge) === "kinship"}
                      onChange={(event) =>
                        patchSelectedEdge({
                          relationshipKind: event.target.checked ? "kinship" : "general",
                        })
                      }
                    />
                  }
                  labels={{
                    title: t("relationship"),
                    label: t("nameRelationship"),
                    labelPlaceholder: t("nameRelationship"),
                    directed: t("directed"),
                    reverse: t("reverseDirection"),
                    conflict: t("relationConflict"),
                    lineStyle: t("edgeLineStyle"),
                    lineStyleOptions: {
                      solid: t("edgeLineSolid"),
                      dashed: t("edgeLineDashed"),
                      dotted: t("edgeLineDotted"),
                    },
                    color: t("edgeColor"),
                    colorOptions: {
                      auto: t("edgeColorAuto"),
                      ink: t("edgeColorInk"),
                      gold: t("edgeColorGold"),
                      rose: t("edgeColorRose"),
                      moss: t("edgeColorMoss"),
                      blue: t("edgeColorBlue"),
                    },
                  }}
                  labelPlaceholder={selectedEdgeLabel.inherited || t("nameRelationship")}
                  toggleConflict={toggleEdgeConflict}
                  reverseConflict={reverseEdgeConflict}
                  onLabelChange={(label) => patchSelectedEdge({ label })}
                  onLineStyleChange={(lineStyle) => patchSelectedEdge({ lineStyle })}
                  onColorChange={(color) => patchSelectedEdge({ color })}
                  onDirectedChange={(directed) => {
                    if (toggleEdgeConflict) return;
                    patchSelectedEdge({ gerichtet: directed });
                  }}
                  onReverse={() => {
                    if (reverseEdgeConflict) return;
                    patchSelectedEdge({
                      from: visibleSelectedEdge.to,
                      to: visibleSelectedEdge.from,
                    });
                  }}
                />
              </Panel>
            ) : undefined
          }
        >
          {timelineOpen && (
            <TimelineStrip
              timeline={timeline}
              activeId={activeMomentId}
              playing={playing}
              onPlay={() => {
                if (!timeline.length) return;
                if (playing) {
                  setPlaying(false);
                  return;
                }
                if (!activeMomentId || activeMomentId === timeline.at(-1)?.id) {
                  setActiveMomentId(timeline[0].id);
                }
                setPlaying(true);
              }}
              onSelect={(id) => {
                setPlaying(false);
                setActiveMomentId(id);
              }}
              onAdd={(title, date) => {
                const moment = { id: uid("t"), title, ...(date ? { date } : {}) };
                onChange({
                  ...state,
                  timeline: insertTimelineMoment(timeline, moment, timeline.length),
                });
                setActiveMomentId(moment.id);
              }}
              onPatch={(id, patch) =>
                onChange({
                  ...state,
                  timeline: timeline.map((moment) =>
                    moment.id === id ? { ...moment, ...patch } : moment,
                  ),
                })
              }
              onDelete={setDeleteMoment}
            />
          )}
        </FigureCanvas>
        <SidePanel
          className={`figure-inspector ${selected ? "has-selection" : ""}`}
          label={t("figureInspectorLabel")}
        >
          <SidePanelHeader
            className="figure-inspector-header"
            title={selected ? t("selection") : t("inspector")}
            actions={
              selected ? (
                <IconButton
                  label={t("closeSelection")}
                  icon={<X />}
                  onClick={() => setSelectedId(null)}
                />
              ) : undefined
            }
          />
          {!selected ? (
            <SidePanelEmpty
              className="figure-inspector-empty"
              icon={<UserRound />}
              title={t("selectElement")}
            >
              <p>{t("selectElementHelp")}</p>
            </SidePanelEmpty>
          ) : (
            <FigureInspector
              figure={selected}
              state={state}
              activeMomentId={activeMomentId}
              onPatch={(patch) => patchNode(selected.id, patch)}
              onState={onChange}
              onDelete={() => setConfirmDelete(true)}
              onSelectMoment={(id) => {
                setPlaying(false);
                setActiveMomentId(id);
              }}
            />
          )}
        </SidePanel>
      </div>
      <FigureNodeContextMenu
        menu={nodeMenu}
        nodes={state.nodes}
        onClose={closeNodeMenu}
        onOpenInspector={(id) => {
          setSelectedId(id);
          setNodeMenu(null);
        }}
        onConnect={(id) => {
          setSelectedId(id);
          setConnecting(true);
          setNodeMenu(null);
        }}
        onPatch={patchNode}
        onDelete={(id) => {
          setSelectedId(id);
          setConfirmDelete(true);
          setNodeMenu(null);
        }}
      />
      {connectionError && (
        <Toast
          className="story-world-toast"
          tone="danger"
          title={connectionError}
          dismissLabel={t("closeMessage")}
          onDismiss={() => setConnectionError("")}
        />
      )}
      {selected && confirmDelete && (
        <ConfirmDialog
          title={t("deleteElement")}
          description={t("deleteElementDescription").replace("{name}", selected.name)}
          supportingText={t("undoHint", { shortcut: storyShortcutLabel("Z", locale) })}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteElement")}
          onConfirm={removeSelected}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {deleteMoment && (
        <ConfirmDialog
          title={t("deleteMoment")}
          description={t("deleteTimeMomentDescription").replace("{title}", deleteMoment.title)}
          supportingText={t("undoHint", { shortcut: storyShortcutLabel("Z", locale) })}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteMoment")}
          onConfirm={() => {
            onChange({
              ...state,
              timeline: removeTimelineMoment(timeline, deleteMoment.id),
              edges: state.edges.map((edge) => ({
                ...edge,
                versions: edge.versions?.filter((version) => version.momentId !== deleteMoment.id),
              })),
              nodes: state.nodes.map((node) =>
                node.diedMomentId === deleteMoment.id ? { ...node, diedMomentId: undefined } : node,
              ),
              presence: presence.filter((entry) => entry.momentId !== deleteMoment.id),
            });
            if (activeMomentId === deleteMoment.id) setActiveMomentId(null);
          }}
          onClose={() => setDeleteMoment(null)}
        />
      )}
    </section>
  );
}
