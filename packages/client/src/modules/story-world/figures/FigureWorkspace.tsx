import { ReactFlowProvider } from "@xyflow/react";
import { UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConfirmDialog,
  IconButton,
  SidePanel,
  SidePanelEmpty,
  SidePanelHeader,
  Toast,
} from "../../../design";
import { useI18n } from "../../../i18n";
import { uid } from "../../../shared/id";
import type { FigureNode, FigureState, PresenceEntry, TimelineMoment } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { insertTimelineMoment, removeTimelineMoment } from "../timeline/order";
import { FigureCanvas } from "./FigureCanvas";
import { FigureInspector } from "./FigureInspector";
import { FigureNodeContextMenu, type FigureNodeMenuState } from "./FigureNodeContextMenu";
import { FigureToolbar } from "./FigureToolbar";
import { prunePresence } from "./presence";
import { TimelineStrip } from "./TimelineStrip";
import { useFigureCanvas } from "./useFigureCanvas";

const EMPTY_TIMELINE: TimelineMoment[] = [];
const EMPTY_PRESENCE: PresenceEntry[] = [];

export type FigureWorkspaceProps = {
  state: FigureState;
  onChange: (value: FigureState) => void;
  targetId?: string;
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
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: FigureWorkspaceProps) {
  const { locale, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    onSelectNode: setSelectedId,
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
    };
    document.addEventListener("keydown", closeModes);
    return () => document.removeEventListener("keydown", closeModes);
  }, []);
  useEffect(() => {
    if (!targetId) return;
    const current = latestState.current;
    const item = current.nodes.find((node) => node.id === targetId);
    if (item) {
      setSelectedId(targetId);
      centerOnNode.current(item);
      return;
    }
    if ((current.timeline ?? EMPTY_TIMELINE).some((moment) => moment.id === targetId)) {
      setActiveMomentId(targetId);
      setTimelineOpen(true);
    }
  }, [targetId]);
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
        onRelationshipsVisibleChange={setRelationshipsVisible}
        onTimelineOpenChange={setTimelineOpen}
        onJourneyOverlayOpenChange={setJourneyOverlayOpen}
        onUndo={onUndo}
        onRedo={onRedo}
        onImport={(imported) => {
          onChange(imported);
          setSelectedId(null);
        }}
      />
      <div className="figure-layout">
        <FigureCanvas
          controller={canvas}
          connecting={connecting}
          playing={playing}
          onCancelConnecting={() => setConnecting(false)}
          onSelectNode={setSelectedId}
          onOpenNodeMenu={(node, x, y, trigger) => {
            setSelectedId(node.id);
            setNodeMenu({ id: node.id, x, y, trigger });
          }}
          onClearSelection={() => {
            setSelectedId(null);
            setNodeMenu(null);
          }}
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
