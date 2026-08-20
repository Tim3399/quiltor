import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  applyNodeChanges,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type MiniMapNodeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Clock3,
  Download,
  Grid3X3,
  LayoutGrid,
  Link2,
  MapPin,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Redo2,
  Skull,
  Star,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import type {
  FigureEdge,
  FigureNode,
  FigureState,
  FigureKind,
  PresenceEntry,
  Profile,
  TimelineMoment,
} from "../../types";
import { PROFILE_FIELDS, uid } from "../../types";
import { download, errorMessage } from "../../lib/api";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { useShortcut } from "../../shared/ui/shortcuts";
import { ContextMenu, Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";
import { Popover } from "../../shared/ui/Popover";
import {
  figureJourney,
  journeyHandles,
  journeyLegs,
  momentIndex,
  patchPresence,
  presenceByPlace,
  presenceFieldEditor,
  prunePresence,
  resolvePresence,
  stopDateDiff,
} from "./presence";
import { formatMomentDate } from "./date";
import { useLanguage, type MessageKey } from "../../language";
import {
  GRID_SIZE,
  alignNodesToGrid,
  connectionKind,
  figureIsDeceased,
  kindLabel,
  patchRelationship,
  relationshipHandles,
  relationshipKey,
  relationshipLabelEditor,
  resolveRelationship,
  resolveRelationshipOverview,
  semanticZoomTier,
  type SemanticZoomTier,
} from "./relationships";
import "./FigureWorkspace.css";

type CardData = {
  figure: FigureNode;
  deceased: boolean;
  guests: FigureNode[];
  zoomTier: SemanticZoomTier;
  zoom: number;
};
const nodeTypes = { story: StoryNode };
const EMPTY_TIMELINE: TimelineMoment[] = [];
const EMPTY_PRESENCE: PresenceEntry[] = [];
const EMPTY_NODES: FigureNode[] = [];
const ELEMENT_TYPES: Array<{
  kind: FigureKind;
  label: MessageKey;
  initialName: MessageKey;
  nodeLabel: MessageKey;
  quick: boolean;
}> = [
  {
    kind: "person",
    label: "figure",
    initialName: "newFigureName",
    nodeLabel: "nodeRoleLabel",
    quick: true,
  },
  { kind: "ort", label: "place", initialName: "newPlace", nodeLabel: "place", quick: true },
  {
    kind: "konzept",
    label: "concept",
    initialName: "newConceptName",
    nodeLabel: "concept",
    quick: true,
  },
  {
    kind: "tier",
    label: "animal",
    initialName: "newAnimalName",
    nodeLabel: "animalRoleLabel",
    quick: false,
  },
  {
    kind: "organisation",
    label: "organisation",
    initialName: "newOrganisationName",
    nodeLabel: "organisationRoleLabel",
    quick: false,
  },
  {
    kind: "objekt",
    label: "object",
    initialName: "newObjectName",
    nodeLabel: "objectRoleLabel",
    quick: false,
  },
];

function StoryNode({ data, selected }: NodeProps<Node<CardData>>) {
  const { t } = useLanguage();
  const item = data.figure;
  const semanticScale = data.zoomTier === "overview" ? 1 / Math.max(data.zoom, 0.08) : 1;
  return (
    <div
      style={{ "--semantic-scale": semanticScale } as CSSProperties}
      className={`story-node zoom-${data.zoomTier} type-${item.type || "person"} accent-${item.accent || "ink"} ${item.important ? "is-important" : ""} ${item.dash ? "dashed" : ""} ${data.deceased ? "is-deceased" : ""} ${data.guests.length ? "has-guests" : ""} ${selected ? "selected" : ""}`}
    >
      <Handle
        id="in"
        className="directed-handle incoming-handle"
        type="target"
        position={Position.Left}
      />
      <Handle id="neutral-top" className="neutral-handle" type="source" position={Position.Top} />
      <Handle
        id="journey-top"
        className="journey-handle"
        type="source"
        position={Position.Top}
        isConnectable={false}
      />
      <Handle
        id="journey-bottom"
        className="journey-handle"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
      />
      <span className="node-kind">
        {item.type !== "person" ? kindLabel(item.type, t) : item.label || t("figure")}
      </span>
      <strong>
        {item.important && <Star className="importance-mark" aria-label={t("important")} />}
        {item.name}
        {data.deceased && <Skull aria-label={t("deceased")} />}
      </strong>
      {item.sub && <small>{item.sub}</small>}
      {data.guests.length > 0 && (
        <small className="node-guests">
          {data.guests
            .slice(0, 3)
            .map((guest) => guest.name)
            .join(", ")}
          {data.guests.length > 3 ? ` +${data.guests.length - 3}` : ""}
        </small>
      )}
      <Handle
        id="out"
        className="directed-handle outgoing-handle"
        type="source"
        position={Position.Right}
      />
      <Handle
        id="neutral-bottom"
        className="neutral-handle"
        type="source"
        position={Position.Bottom}
      />
    </div>
  );
}

const MINIMAP_NODE_SIZE = 40;

function MiniMapDot({
  x,
  y,
  width,
  height,
  color,
  strokeColor,
  strokeWidth,
  borderRadius,
  className,
  selected,
}: MiniMapNodeProps) {
  return (
    <rect
      className={`react-flow__minimap-node ${selected ? "selected" : ""} ${className ?? ""}`}
      x={x + width / 2 - MINIMAP_NODE_SIZE / 2}
      y={y + height / 2 - MINIMAP_NODE_SIZE / 2}
      width={MINIMAP_NODE_SIZE}
      height={MINIMAP_NODE_SIZE}
      rx={borderRadius}
      ry={borderRadius}
      style={{ fill: color, stroke: strokeColor, strokeWidth }}
    />
  );
}

export function minimapColorForKind(kind?: FigureKind) {
  if (kind === "ort") return "var(--minimap-place)";
  if (kind === "konzept") return "var(--minimap-concept)";
  if (kind === "tier") return "var(--minimap-animal)";
  if (kind === "organisation") return "var(--minimap-organisation)";
  if (kind === "objekt") return "var(--minimap-object)";
  return "var(--minimap-person)";
}

type FigureWorkspaceProps = {
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
  const { t } = useLanguage();
  const keys = useShortcut();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridOverride, setGridOverride] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImport, setPendingImport] = useState<FigureState | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [relationshipsVisible, setRelationshipsVisible] = useState(true);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(() => !!state.timeline?.length);
  const [journeyOverlayOpen, setJourneyOverlayOpen] = useState(() => !!state.presence?.length);
  const [playing, setPlaying] = useState(false);
  const [deleteMoment, setDeleteMoment] = useState<TimelineMoment | null>(null);
  const [importError, setImportError] = useState("");
  const [exportError, setExportError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const manageButton = useRef<HTMLButtonElement>(null);
  const flow = useRef<ReactFlowInstance<Node<CardData>, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;
  const selected = state.nodes.find((node) => node.id === selectedId) ?? null;
  const timeline = state.timeline ?? EMPTY_TIMELINE;
  const presence = state.presence ?? EMPTY_PRESENCE;
  useEffect(() => {
    const setOverride = (event: KeyboardEvent) => {
      if (event.key === "Alt") setGridOverride(event.type === "keydown");
    };
    const clearOverride = () => setGridOverride(false);
    window.addEventListener("keydown", setOverride);
    window.addEventListener("keyup", setOverride);
    window.addEventListener("blur", clearOverride);
    return () => {
      window.removeEventListener("keydown", setOverride);
      window.removeEventListener("keyup", setOverride);
      window.removeEventListener("blur", clearOverride);
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (connecting) setConnecting(false);
      if (nodeMenu) setNodeMenu(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [connecting, nodeMenu]);
  useEffect(() => {
    if (!nodeMenu) return;
    const close = () => setNodeMenu(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [nodeMenu]);
  useEffect(() => {
    if (!targetId) return;
    const item = latestState.current.nodes.find((node) => node.id === targetId);
    if (item) {
      setSelectedId(targetId);
      setTimeout(() => flow.current?.setCenter(item.x, item.y, { zoom: 1, duration: 350 }), 0);
      return;
    }
    if ((latestState.current.timeline ?? EMPTY_TIMELINE).some((moment) => moment.id === targetId)) {
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
  const guestsByPlace = useMemo(
    () => presenceByPlace(state.nodes, presence, timeline, activeMomentId),
    [state.nodes, presence, timeline, activeMomentId],
  );
  const derivedNodes = useMemo<Node<CardData>[]>(
    () =>
      state.nodes.map((item) => ({
        id: item.id,
        type: "story",
        position: { x: item.x, y: item.y },
        draggable: !item.pinned,
        data: {
          figure: item,
          deceased: figureIsDeceased(item, timeline, activeMomentId),
          guests: EMPTY_NODES,
          zoomTier,
          zoom: viewportZoom,
        },
      })),
    [state.nodes, zoomTier, viewportZoom],
  );
  const [nodes, setFlowNodes] = useState<Node<CardData>[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);
  useEffect(() => {
    setFlowNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          deceased: figureIsDeceased(node.data.figure, timeline, activeMomentId),
          guests: guestsByPlace.get(node.id) ?? EMPTY_NODES,
        },
      })),
    );
  }, [timeline, activeMomentId, guestsByPlace]);
  const visibleEdges = useMemo(
    () =>
      state.edges
        .map((edge) =>
          activeMomentId
            ? resolveRelationship(edge, timeline, activeMomentId)
            : resolveRelationshipOverview(edge, timeline),
        )
        .filter((edge) => edge.active),
    [state.edges, timeline, activeMomentId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((edge) => {
        const handles = relationshipHandles(edge, state.nodes);
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: handles.from,
          targetHandle: handles.to,
          label: edge.label,
          labelBgStyle: { fill: "var(--edge-label-bg)" },
          labelStyle: { fill: "var(--edge-label-text)" },
          animated: edge.style === "blood",
          className: `edge-${edge.style || "solid"} ${edge.gerichtet ? "edge-directed" : "edge-undirected"} ${!activeMomentId && edge.versions?.length ? "edge-temporal" : ""}`,
          markerEnd: edge.gerichtet ? { type: "arrowclosed" as const } : undefined,
        };
      }),
    [visibleEdges, activeMomentId, state.nodes],
  );
  const journeyEdges = useMemo<Edge[]>(() => {
    if (
      !journeyOverlayOpen ||
      !selected ||
      (selected.type !== "person" && selected.type !== "tier")
    )
      return [];
    const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
    const stops = figureJourney(selected, presence, timeline);
    const legs = journeyLegs(stops, timeline, activeMomentId);
    const result: Edge[] = [];
    legs.forEach((leg, index) => {
      const fromNode = nodeById.get(leg.from.placeId),
        toNode = nodeById.get(leg.to.placeId);
      if (!fromNode || !toNode) return;
      const handles = journeyHandles(fromNode, toNode);
      result.push({
        id: `journey:${selected.id}:${index}`,
        source: leg.from.placeId,
        target: leg.to.placeId,
        sourceHandle: handles.from,
        targetHandle: handles.to,
        label: leg.to.momentId
          ? [
              timeline.find((moment) => moment.id === leg.to.momentId)?.title,
              stopDateDiff(leg.from, leg.to, timeline).label,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined,
        labelBgStyle: { fill: "var(--edge-label-bg)" },
        labelStyle: { fill: "var(--edge-label-text)" },
        markerEnd: { type: "arrowclosed" as const },
        animated: leg.current,
        zIndex: 5,
        className: `journey-edge ${leg.walked ? "journey-walked" : "journey-ahead"} ${leg.current ? "journey-current" : ""}`,
      });
    });
    const currentPresence = resolvePresence(selected.id, presence, timeline, activeMomentId);
    const placeNode = currentPresence ? nodeById.get(currentPresence.placeId) : undefined;
    if (activeMomentId && placeNode && !figureIsDeceased(selected, timeline, activeMomentId)) {
      const handles = journeyHandles(selected, placeNode);
      result.push({
        id: `presence:${selected.id}`,
        source: selected.id,
        target: placeNode.id,
        sourceHandle: handles.from,
        targetHandle: handles.to,
        zIndex: 5,
        className: "presence-edge",
      });
    }
    return result;
  }, [journeyOverlayOpen, selected, presence, timeline, activeMomentId, state.nodes]);
  const allEdges = useMemo<Edge[]>(
    () => [...(relationshipsVisible ? edges : []), ...journeyEdges],
    [relationshipsVisible, edges, journeyEdges],
  );

  const patchNode = (id: string, patch: Partial<FigureNode>) =>
    onChange({
      ...state,
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  const addNode = (kind: FigureKind) => {
    const center = flow.current?.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }) ?? { x: 300, y: 250 };
    const position = snapToGrid
      ? {
          x: Math.round(center.x / GRID_SIZE) * GRID_SIZE,
          y: Math.round(center.y / GRID_SIZE) * GRID_SIZE,
        }
      : center;
    const definition = ELEMENT_TYPES.find((item) => item.kind === kind) ?? ELEMENT_TYPES[0];
    const node: FigureNode = {
      id: uid("n"),
      x: position.x,
      y: position.y,
      type: kind,
      label: t(definition.nodeLabel),
      name: t(definition.initialName),
      sub: "",
      accent: "ink",
      profile: { extra: [] },
    };
    onChange({ ...state, nodes: [...state.nodes, node] });
    setSelectedId(node.id);
    setCreateMenuOpen(false);
  };
  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const kind = connectionKind(connection.sourceHandle, connection.targetHandle);
      if (!kind) {
        setConnectionError(t("connectDirectedHelp"));
        return;
      }
      const duplicate = state.edges.find(
        (edge) =>
          relationshipKey(edge.from, edge.to, !!edge.gerichtet) ===
          relationshipKey(connection.source!, connection.target!, kind === "directed"),
      );
      if (duplicate) {
        setSelectedId(duplicate.from);
        setConnecting(false);
        setConnectionError(t("relationExists"));
        return;
      }
      const edge: FigureEdge = {
        id: uid("e"),
        from: connection.source,
        to: connection.target,
        fromHandle: connection.sourceHandle || undefined,
        toHandle: connection.targetHandle || undefined,
        gerichtet: kind === "directed",
        label: "",
        style: "solid",
        ...(activeMomentId
          ? {
              active: false,
              versions: [
                {
                  momentId: activeMomentId,
                  label: "",
                  style: "solid",
                  gerichtet: kind === "directed",
                  active: true,
                },
              ],
            }
          : {}),
      };
      onChange({ ...state, edges: [...state.edges, edge] });
      setRelationshipsVisible(true);
      setConnectionError("");
    },
    [activeMomentId, onChange, state, t],
  );
  const moveNodes = useCallback((changes: NodeChange<Node<CardData>>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const commitNodePosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      const current = latestState.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, x: position.x, y: position.y } : node,
        ),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals(current.nodes.map((node) => node.id)));
    },
    [onChange, updateNodeInternals],
  );
  const alignAllNodes = useCallback(() => {
    const current = latestState.current;
    const next = { ...current, nodes: alignNodesToGrid(current.nodes) };
    latestState.current = next;
    onChange(next);
    window.requestAnimationFrame(() => updateNodeInternals(next.nodes.map((node) => node.id)));
  }, [onChange, updateNodeInternals]);
  const remove = () => {
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
  // Saving an export can fail for real now that the desktop app writes the file itself
  // (see download() in lib/api.ts) -- a rejected promise here has to reach the reader.
  const runExport = (task: Promise<void>) => {
    void task.then(() => setExportError("")).catch((error) => setExportError(errorMessage(error)));
  };
  const exportState = () =>
    runExport(
      download(
        `quiltor-figuren-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(state, null, 2),
        "application/json",
      ),
    );
  const exportProfiles = () =>
    runExport(
      download(
        `Quiltor-Steckbriefe-${new Date().toISOString().slice(0, 10)}.md`,
        state.nodes
          .map((node) => {
            const profile = node.profile || {};
            const lines = [
              `# ${node.name}`,
              "",
              node.label ? `*${node.label}*` : "",
              node.sub || "",
              "",
            ];
            PROFILE_FIELDS.forEach(([key, label]) => {
              const value = String(profile[key] || "").trim();
              if (value) lines.push(`## ${label}`, "", value, "");
            });
            (profile.extra || []).forEach((field) => {
              if (field.k || field.v)
                lines.push(`## ${field.k || t("untitled")}`, "", field.v || "", "");
            });
            return lines
              .filter((line, index) => line || lines[index - 1])
              .join("\n")
              .trim();
          })
          .join("\n\n---\n\n"),
      ),
    );
  const importState = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as FigureState;
      if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error();
      setPendingImport(value);
      setImportError("");
    } catch {
      setImportError(t("invalidDiagramFile"));
    }
    if (input.current) input.current.value = "";
  };

  return (
    <section className="figure-workspace" aria-label={t("figuresAndRelationsLabel")}>
      <div className="context-bar">
        <div className="context-title">
          <strong>{t("figuresWorld")}</strong>
          <span>
            {t("nElements", { n: state.nodes.length })} ·{" "}
            {t("nRelationships", { n: state.edges.length })}
          </span>
        </div>
        <div className="tool-group create-group">
          <button
            ref={createButton}
            className="create-action primary"
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
            onClick={() => setCreateMenuOpen((value) => !value)}
          >
            <Plus />
            {t("element")}
          </button>
          <Popover
            anchorRef={createButton}
            open={createMenuOpen}
            onClose={() => setCreateMenuOpen(false)}
            label={t("createElementMenu")}
          >
            <Menu label={t("createElementMenu")} onClose={() => setCreateMenuOpen(false)}>
              {ELEMENT_TYPES.map((type) => (
                <MenuItem key={type.kind} onSelect={() => addNode(type.kind)}>
                  <Plus />
                  {t(type.label)}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </div>
        <div className="tool-group">
          <button
            aria-pressed={connecting}
            className={connecting ? "active" : ""}
            onClick={() => {
              setConnecting((value) => !value);
              if (!connecting) setRelationshipsVisible(true);
            }}
          >
            <Link2 />
            {t("connect")}
          </button>
        </div>
        <div className="tool-group">
          <button
            ref={viewButton}
            aria-expanded={viewMenuOpen}
            aria-haspopup="menu"
            onClick={() => setViewMenuOpen((value) => !value)}
          >
            <Grid3X3 />
            {t("figureViewMenu")}
          </button>
          <Popover
            anchorRef={viewButton}
            open={viewMenuOpen}
            onClose={() => setViewMenuOpen(false)}
            label={t("figureViewMenu")}
          >
            <Menu label={t("figureViewMenu")} onClose={() => setViewMenuOpen(false)}>
              <MenuItem
                onSelect={() => {
                  setSnapToGrid((value) => !value);
                  setViewMenuOpen(false);
                }}
              >
                <Grid3X3 />
                {snapToGrid ? t("hideGrid") : t("showGrid")}
              </MenuItem>
              <MenuItem
                disabled={!state.nodes.length}
                onSelect={() => {
                  alignAllNodes();
                  setViewMenuOpen(false);
                }}
              >
                <LayoutGrid />
                {t("arrangeGrid")}
              </MenuItem>
              <MenuItem
                disabled={!state.edges.length}
                onSelect={() => {
                  setRelationshipsVisible((value) => !value);
                  setViewMenuOpen(false);
                }}
              >
                <Link2 />
                {relationshipsVisible ? t("hideRelationships") : t("showRelationships")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  setTimelineOpen((value) => !value);
                  setViewMenuOpen(false);
                }}
              >
                <Clock3 />
                {timelineOpen ? t("hideTimeline") : t("showTimeline")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setJourneyOverlayOpen((value) => !value);
                  setViewMenuOpen(false);
                }}
              >
                <MapPin />
                {journeyOverlayOpen ? t("hidePaths") : t("showPaths")}
              </MenuItem>
            </Menu>
          </Popover>
        </div>
        <div className="tool-group">
          <button
            disabled={!canUndo}
            onClick={onUndo}
            aria-label={t("undoDiagram")}
            title={`${t("undoDiagram")} · ${keys("Z")}`}
          >
            <Undo2 />
          </button>
          <button
            disabled={!canRedo}
            onClick={onRedo}
            aria-label={t("redoDiagram")}
            title={`${t("redoDiagram")} · ${keys("Z", { shift: true })}`}
          >
            <Redo2 />
          </button>
        </div>
        <div className="tool-group">
          <button
            ref={manageButton}
            aria-expanded={manageMenuOpen}
            aria-haspopup="menu"
            aria-label={t("figureManageMenu")}
            onClick={() => setManageMenuOpen((value) => !value)}
          >
            <MoreHorizontal />
          </button>
          <Popover
            anchorRef={manageButton}
            open={manageMenuOpen}
            onClose={() => setManageMenuOpen(false)}
            label={t("figureManageMenu")}
          >
            <Menu label={t("figureManageMenu")} onClose={() => setManageMenuOpen(false)}>
              <MenuItem
                onSelect={() => {
                  exportProfiles();
                  setManageMenuOpen(false);
                }}
              >
                <Download />
                {t("profiles")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  exportState();
                  setManageMenuOpen(false);
                }}
              >
                <Download />
                JSON
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  input.current?.click();
                  setManageMenuOpen(false);
                }}
              >
                <Upload />
                {t("import")}
              </MenuItem>
            </Menu>
          </Popover>
          <input
            ref={input}
            hidden
            type="file"
            accept="application/json"
            onChange={(event) => void importState(event.target.files?.[0])}
          />
        </div>
      </div>
      <div className="figure-layout">
        <div
          className={`flow-area zoom-${zoomTier} ${connecting ? "is-connecting" : ""} ${playing ? "timeline-playing" : ""}`}
        >
          {connecting && (
            <div className="mode-banner" role="status">
              <Link2 />
              <span>{t("connectModeHint")}</span>
              <button onClick={() => setConnecting(false)}>
                <X />
                <span className="sr-only">{t("cancel")}</span>
              </button>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={allEdges}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            onInit={(instance) => {
              flow.current = instance;
              const zoom = instance.getZoom();
              setViewportZoom(zoom);
              setZoomTier(semanticZoomTier(zoom));
            }}
            onMove={(_, viewport) => {
              const zoom = Math.round(viewport.zoom * 100) / 100;
              setViewportZoom((current) => (current === zoom ? current : zoom));
              setZoomTier((current) => {
                const next = semanticZoomTier(zoom);
                return current === next ? current : next;
              });
            }}
            onNodeClick={(_, node: Node<CardData>) => setSelectedId(node.id)}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setSelectedId(node.id);
              setNodeMenu({ id: node.id, x: event.clientX, y: event.clientY });
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setNodeMenu(null);
            }}
            onNodesChange={moveNodes}
            onNodeDragStop={(_, node) => commitNodePosition(node.id, node.position)}
            onConnect={connect}
            nodesConnectable={connecting}
            snapToGrid={snapToGrid && !gridOverride}
            snapGrid={[GRID_SIZE, GRID_SIZE]}
            fitView
            minZoom={0.08}
            maxZoom={2.2}
            deleteKeyCode={null}
          >
            {snapToGrid && zoomTier !== "overview" && (
              <Background
                className={`board-grid board-grid-${zoomTier}`}
                variant={BackgroundVariant.Lines}
                gap={GRID_SIZE}
                size={0.55}
                color="var(--line)"
              />
            )}
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeComponent={MiniMapDot}
              nodeColor={(node) => minimapColorForKind((node.data as CardData).figure.type)}
              maskColor="var(--minimap-mask)"
            />
          </ReactFlow>
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
                if (!activeMomentId || activeMomentId === timeline.at(-1)?.id)
                  setActiveMomentId(timeline[0].id);
                setPlaying(true);
              }}
              onSelect={(id) => {
                setPlaying(false);
                setActiveMomentId(id);
              }}
              onAdd={(title, date) => {
                const moment = { id: uid("t"), title, ...(date ? { date } : {}) };
                onChange({ ...state, timeline: [...timeline, moment] });
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
              onDelete={(moment) => setDeleteMoment(moment)}
            />
          )}
        </div>
        <aside
          className={`inspector figure-inspector ${selected ? "has-selection" : ""}`}
          aria-label={t("figureInspectorLabel")}
        >
          <div className="panel-heading">
            <span>{selected ? t("selection") : t("inspector")}</span>
            {selected && (
              <button
                className="icon-button"
                onClick={() => setSelectedId(null)}
                aria-label={t("closeSelection")}
              >
                <X />
              </button>
            )}
          </div>
          {!selected ? (
            <div className="empty-inspector">
              <UserRound />
              <h2>{t("selectElement")}</h2>
              <p>{t("selectElementHelp")}</p>
            </div>
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
        </aside>
      </div>
      {nodeMenu && (
        <div
          className="node-context-menu material-popover"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ContextMenu label={t("elementActions")} onClose={() => setNodeMenu(null)}>
            <MenuItem
              onSelect={() => {
                setSelectedId(nodeMenu.id);
                setNodeMenu(null);
              }}
            >
              <UserRound />
              {t("openInInspector")}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setSelectedId(nodeMenu.id);
                setConnecting(true);
                setNodeMenu(null);
              }}
            >
              <Link2 />
              {t("connect")}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                const node = state.nodes.find((item) => item.id === nodeMenu.id);
                if (node) patchNode(node.id, { important: !node.important });
                setNodeMenu(null);
              }}
            >
              <Star />
              {state.nodes.find((item) => item.id === nodeMenu.id)?.important
                ? t("unmarkImportant")
                : t("markImportant")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                setSelectedId(nodeMenu.id);
                setConfirmDelete(true);
                setNodeMenu(null);
              }}
            >
              <Trash2 />
              {t("deleteElement")}
            </MenuItem>
          </ContextMenu>
        </div>
      )}
      {importError && (
        <div className="toast error-box" role="alert">
          {importError}
          <button onClick={() => setImportError("")}>
            <X />
            <span className="sr-only">{t("closeMessage")}</span>
          </button>
        </div>
      )}
      {exportError && (
        <div className="toast error-box" role="alert">
          {exportError}
          <button onClick={() => setExportError("")}>
            <X />
            <span className="sr-only">{t("closeMessage")}</span>
          </button>
        </div>
      )}
      {connectionError && (
        <div className="toast error-box" role="alert">
          {connectionError}
          <button onClick={() => setConnectionError("")}>
            <X />
            <span className="sr-only">{t("closeMessage")}</span>
          </button>
        </div>
      )}
      {selected && confirmDelete && (
        <ConfirmDialog
          title={t("deleteElement")}
          description={t("deleteElementDescription").replace("{name}", selected.name)}
          confirmLabel={t("deleteElement")}
          undoable
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {pendingImport && (
        <ConfirmDialog
          title={t("importDiagram")}
          description={t("importDiagramDescription")
            .replace("{nodes}", String(pendingImport.nodes.length))
            .replace("{edges}", String(pendingImport.edges.length))}
          confirmLabel={t("importAction")}
          undoable
          onConfirm={() => {
            onChange(pendingImport);
            setSelectedId(null);
            setPendingImport(null);
          }}
          onClose={() => setPendingImport(null)}
        />
      )}
      {deleteMoment && (
        <ConfirmDialog
          title={t("deleteMoment")}
          description={t("deleteTimeMomentDescription").replace("{title}", deleteMoment.title)}
          confirmLabel={t("deleteMoment")}
          undoable
          onConfirm={() => {
            onChange({
              ...state,
              timeline: timeline.filter((moment) => moment.id !== deleteMoment.id),
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

function FigureInspector({
  figure,
  state,
  activeMomentId,
  onPatch,
  onState,
  onDelete,
  onSelectMoment,
}: {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onPatch: (patch: Partial<FigureNode>) => void;
  onState: (state: FigureState) => void;
  onDelete: () => void;
  onSelectMoment: (id: string | null) => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"card" | "profile" | "links">("card");
  // Deleting a relationship also drops every version it carries at individual moments, which the
  // row itself does not show -- so it asks first, at the same level as deleting an element.
  const [deleteEdge, setDeleteEdge] = useState<{ edge: FigureEdge; name: string } | null>(null);
  const profile = figure.profile || { extra: [] };
  const patchProfile = (patch: Partial<Profile>) => onPatch({ profile: { ...profile, ...patch } });
  const linked = state.edges.filter((edge) => edge.from === figure.id || edge.to === figure.id);
  return (
    <>
      <div className="panel-tabs three" role="tablist">
        <button role="tab" aria-selected={tab === "card"} onClick={() => setTab("card")}>
          {t("card")}
        </button>
        <button role="tab" aria-selected={tab === "profile"} onClick={() => setTab("profile")}>
          {t("profile")}
        </button>
        <button role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>
          {t("relationships")}
        </button>
      </div>
      <div className="panel-body">
        {tab === "card" && (
          <>
            <label className="field">
              <span>{t("kind")}</span>
              <select
                value={figure.type || "person"}
                onChange={(event) => onPatch({ type: event.target.value as FigureKind })}
              >
                <option value="person">{t("figure")}</option>
                <option value="tier">{t("animal")}</option>
                <option value="ort">{t("place")}</option>
                <option value="organisation">{t("organisation")}</option>
                <option value="objekt">{t("object")}</option>
                <option value="konzept">{t("concept")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("name")}</span>
              <input
                value={figure.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("category")}</span>
              <input
                value={figure.label || ""}
                onChange={(event) => onPatch({ label: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("shortDescription")}</span>
              <textarea
                value={figure.sub || ""}
                onChange={(event) => onPatch({ sub: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("accent")}</span>
              <select
                value={figure.accent || "ink"}
                onChange={(event) =>
                  onPatch({ accent: event.target.value as FigureNode["accent"] })
                }
              >
                <option value="ink">{t("neutral")}</option>
                <option value="gold">{t("gold")}</option>
                <option value="rose">{t("rose")}</option>
                <option value="moss">{t("green")}</option>
              </select>
            </label>
            <div className="node-priority-actions">
              <button
                className={figure.important ? "active" : ""}
                aria-pressed={!!figure.important}
                onClick={() => onPatch({ important: !figure.important })}
              >
                <Star />
                {figure.important ? t("unmarkImportant") : t("markImportant")}
              </button>
              <button
                className={figure.pinned ? "active" : ""}
                aria-pressed={!!figure.pinned}
                onClick={() => onPatch({ pinned: !figure.pinned })}
              >
                <Pin />
                {figure.pinned ? t("unpinPosition") : t("pinPosition")}
              </button>
            </div>
            {activeMomentId && figure.type !== "ort" && figure.type !== "konzept" && (
              <button
                className={`timeline-life-action ${figure.diedMomentId === activeMomentId ? "active" : ""}`}
                onClick={() =>
                  onPatch({
                    diedMomentId:
                      figure.diedMomentId === activeMomentId ? undefined : activeMomentId,
                  })
                }
              >
                <Skull />
                {figure.diedMomentId === activeMomentId ? t("removeDeathMarker") : t("diesHere")}
              </button>
            )}
            {(figure.type === "person" || figure.type === "tier") && (
              <PresenceField
                figure={figure}
                state={state}
                activeMomentId={activeMomentId}
                onState={onState}
                onSelectMoment={onSelectMoment}
              />
            )}
          </>
        )}
        {tab === "profile" && (
          <>
            {PROFILE_FIELDS.map(([key, label, size]) => (
              <label className="field" key={key as string}>
                <span>{t(label)}</span>
                {size === "short" ? (
                  <input
                    value={String(profile[key] || "")}
                    onChange={(event) => patchProfile({ [key]: event.target.value })}
                  />
                ) : (
                  <textarea
                    value={String(profile[key] || "")}
                    onChange={(event) => patchProfile({ [key]: event.target.value })}
                  />
                )}
              </label>
            ))}
            <h3 className="section-label">{t("customFields")}</h3>
            {(profile.extra || []).map((field, index) => (
              <div className="custom-field" key={index}>
                <input
                  aria-label={t("fieldName")}
                  placeholder={t("fieldName")}
                  value={field.k}
                  onChange={(event) =>
                    patchProfile({
                      extra: (profile.extra || []).map((item, i) =>
                        i === index ? { ...item, k: event.target.value } : item,
                      ),
                    })
                  }
                />
                <textarea
                  aria-label={`${field.k || t("customField")} ${t("content")}`}
                  placeholder={t("content")}
                  value={field.v}
                  onChange={(event) =>
                    patchProfile({
                      extra: (profile.extra || []).map((item, i) =>
                        i === index ? { ...item, v: event.target.value } : item,
                      ),
                    })
                  }
                />
                <button
                  className="icon-button danger-text"
                  aria-label={t("removeCustomField")}
                  onClick={() =>
                    patchProfile({ extra: (profile.extra || []).filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <button
              className="secondary-action"
              onClick={() => patchProfile({ extra: [...(profile.extra || []), { k: "", v: "" }] })}
            >
              <Plus />
              {t("customField")}
            </button>
          </>
        )}
        {tab === "links" && (
          <div className="relation-list">
            {linked.length ? (
              linked.map((edge) => {
                const resolved = resolveRelationship(edge, state.timeline || [], activeMomentId);
                const labelEditor = relationshipLabelEditor(
                  edge,
                  state.timeline || [],
                  activeMomentId,
                );
                const otherId = resolved.from === figure.id ? resolved.to : resolved.from;
                const other = state.nodes.find((node) => node.id === otherId);
                const patchEdge = (patch: Partial<FigureEdge>) =>
                  onState({
                    ...state,
                    edges: state.edges.map((item) =>
                      item.id === edge.id
                        ? patchRelationship(item, state.timeline || [], activeMomentId, patch)
                        : item,
                    ),
                  });
                const directionLabel = t("reverseDirectionTo")
                  .replace(
                    "{from}",
                    state.nodes.find((node) => node.id === resolved.from)?.name || t("unknown"),
                  )
                  .replace(
                    "{to}",
                    state.nodes.find((node) => node.id === resolved.to)?.name || t("unknown"),
                  );
                return (
                  <div key={edge.id} className={!resolved.active ? "outside-moment" : ""}>
                    <div>
                      {resolved.gerichtet ? (
                        <button
                          type="button"
                          className="relation-direction"
                          aria-label={directionLabel}
                          title={directionLabel}
                          disabled={!resolved.active}
                          onClick={() => patchEdge({ from: resolved.to, to: resolved.from })}
                        >
                          {resolved.from === figure.id ? "→" : "←"}
                        </button>
                      ) : (
                        <span
                          className="relation-undirected"
                          aria-label={t("undirectedRelation")}
                          title={t("undirectedRelation")}
                        >
                          ↔
                        </span>
                      )}
                      <strong>{other?.name || t("unknown")}</strong>
                      {activeMomentId && (
                        <small>{resolved.active ? t("appliesHere") : t("notActiveHere")}</small>
                      )}
                    </div>
                    <label className="relationship-label-editor">
                      <span className="sr-only">
                        {t("relationToName").replace("{name}", other?.name || "")}
                      </span>
                      <input
                        aria-label={t("relationToName").replace("{name}", other?.name || "")}
                        value={labelEditor.value}
                        placeholder={labelEditor.inherited || t("nameRelationship")}
                        disabled={!resolved.active}
                        onChange={(event) => patchEdge({ label: event.target.value })}
                      />
                    </label>
                    <button
                      className="icon-button danger-text"
                      aria-label={t("deleteConnection")}
                      onClick={() => setDeleteEdge({ edge, name: other?.name || t("unknown") })}
                    >
                      <Trash2 />
                    </button>
                    <select
                      aria-label={t("lineStyle")}
                      value={resolved.style || "solid"}
                      disabled={!resolved.active}
                      onChange={(event) =>
                        patchEdge({ style: event.target.value as typeof edge.style })
                      }
                    >
                      <option value="solid">{t("normal")}</option>
                      <option value="dashed">{t("dashed")}</option>
                      <option value="blood">{t("bloodline")}</option>
                      <option value="gold">{t("gold")}</option>
                    </select>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={!!resolved.gerichtet}
                        disabled={!resolved.active}
                        onChange={(event) => patchEdge({ gerichtet: event.target.checked })}
                      />
                      {t("directed")}
                    </label>
                    {activeMomentId && (
                      <button
                        className="relation-toggle"
                        onClick={() => patchEdge({ active: !resolved.active })}
                      >
                        {resolved.active ? t("relationEndsHere") : t("relationStartsHere")}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="muted">{t("noRelationshipsYet")}</p>
            )}
          </div>
        )}
        <button className="danger-text inspector-delete" onClick={onDelete}>
          <Trash2 />
          {t("deleteKind").replace("{kind}", kindLabel(figure.type, t))}
        </button>
      </div>
      {deleteEdge && (
        <ConfirmDialog
          title={t("deleteConnection")}
          description={t("deleteConnectionDescription", { name: deleteEdge.name })}
          confirmLabel={t("deleteConnection")}
          undoable
          onConfirm={() =>
            onState({
              ...state,
              edges: state.edges.filter((item) => item.id !== deleteEdge.edge.id),
            })
          }
          onClose={() => setDeleteEdge(null)}
        />
      )}
    </>
  );
}

function PresenceField({
  figure,
  state,
  activeMomentId,
  onState,
  onSelectMoment,
}: {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onState: (state: FigureState) => void;
  onSelectMoment: (id: string | null) => void;
}) {
  const { t } = useLanguage();
  const timeline = state.timeline ?? EMPTY_TIMELINE;
  const presence = state.presence ?? EMPTY_PRESENCE;
  const places = state.nodes.filter((node) => node.type === "ort");
  const editor = presenceFieldEditor(figure.id, presence, timeline, activeMomentId);
  const inheritedName = editor.inheritedPlaceId
    ? state.nodes.find((node) => node.id === editor.inheritedPlaceId)?.name
    : undefined;
  const stops = figureJourney(figure, presence, timeline);
  const activeIndex = activeMomentId ? momentIndex(timeline, activeMomentId) : -1;
  const currentStopIndex = stops.reduce<number>(
    (found, stop, index) => (stop.index <= activeIndex ? index : found),
    -1,
  );
  return (
    <div className="presence-field-group">
      <label className="field presence-field">
        <span>
          {activeMomentId
            ? t("placeSinceMoment").replace(
                "{title}",
                timeline.find((moment) => moment.id === activeMomentId)?.title ?? "",
              )
            : t("placeInitial")}
        </span>
        {places.length ? (
          <select
            value={editor.placeId}
            onChange={(event) =>
              onState({
                ...state,
                presence: patchPresence(
                  presence,
                  figure.id,
                  activeMomentId,
                  event.target.value || null,
                ),
              })
            }
          >
            <option value="">
              {activeMomentId
                ? `${t("unchanged")}${inheritedName ? " · " + inheritedName : ""}`
                : t("noPlace")}
            </option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">{t("createPlaceFirst")}</p>
        )}
      </label>
      {stops.length > 0 && (
        <div className="presence-journey">
          {stops.flatMap((stop, index) => {
            const place = state.nodes.find((node) => node.id === stop.placeId);
            const button = (
              <button
                key={`${stop.momentId ?? "base"}-${index}`}
                className={index === currentStopIndex ? "active" : ""}
                onClick={() => onSelectMoment(stop.momentId ?? null)}
              >
                {place?.name ?? t("unknown")}
              </button>
            );
            return index > 0
              ? [
                  <small key={`gap-${index}`} className="presence-journey-duration">
                    {stopDateDiff(stops[index - 1], stop, timeline).label}
                  </small>,
                  button,
                ]
              : [button];
          })}
        </div>
      )}
    </div>
  );
}

function TimelineStrip({
  timeline,
  activeId,
  playing,
  onPlay,
  onSelect,
  onAdd,
  onPatch,
  onDelete,
}: {
  timeline: TimelineMoment[];
  activeId: string | null;
  playing: boolean;
  onPlay: () => void;
  onSelect: (id: string | null) => void;
  onAdd: (title: string, date?: string) => void;
  onPatch: (id: string, patch: Partial<TimelineMoment>) => void;
  onDelete: (moment: TimelineMoment) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(""),
    [draftDate, setDraftDate] = useState("");
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onAdd(title, draftDate || undefined);
    setDraft("");
    setDraftDate("");
  };
  const active = timeline.find((moment) => moment.id === activeId);
  return (
    <div
      className={`timeline-strip ${playing ? "is-playing" : ""}`}
      aria-label={t("timelineStripLabel")}
    >
      <div className="timeline-heading">
        <Clock3 />
        <span>{t("timeToggle")}</span>
        <button
          className="timeline-play"
          disabled={!timeline.length}
          aria-label={playing ? t("pauseTimeTravel") : t("playTimeTravel")}
          onClick={onPlay}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          className={!activeId ? "active" : ""}
          aria-pressed={!activeId}
          onClick={() => onSelect(null)}
        >
          {t("overview")}
        </button>
      </div>
      <div className="timeline-track">
        {timeline.map((moment, index) => (
          <div className="timeline-moment" key={moment.id}>
            <span aria-hidden="true">{index + 1}</span>
            <button
              className={activeId === moment.id ? "active" : ""}
              aria-pressed={activeId === moment.id}
              onClick={() => onSelect(moment.id)}
            >
              <b>{moment.title}</b>
              {moment.date && <small>{formatMomentDate(moment.date)}</small>}
            </button>
          </div>
        ))}
      </div>
      <div className="timeline-add">
        <input
          aria-label={t("newMoment")}
          value={draft}
          placeholder={t("newMoment")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <input
          className="timeline-date"
          type="date"
          aria-label={t("newMomentDate")}
          value={draftDate}
          onChange={(event) => setDraftDate(event.target.value)}
        />
        <button
          className="icon-button"
          disabled={!draft.trim()}
          aria-label={t("addMoment")}
          onClick={add}
        >
          <Plus />
        </button>
      </div>
      {active && (
        <div className="timeline-details">
          <label>
            <span>{t("name")}</span>
            <input
              value={active.title}
              onChange={(event) => onPatch(active.id, { title: event.target.value })}
            />
          </label>
          <label>
            <span>{t("optionalDate")}</span>
            <input
              type="date"
              value={active.date || ""}
              onChange={(event) => onPatch(active.id, { date: event.target.value || undefined })}
            />
          </label>
          <label>
            <span>{t("optionalNote")}</span>
            <input
              value={active.note || ""}
              placeholder={t("momentNotePlaceholder")}
              onChange={(event) => onPatch(active.id, { note: event.target.value })}
            />
          </label>
          <button
            className="icon-button danger-text"
            aria-label={t("deleteMoment")}
            onClick={() => onDelete(active)}
          >
            <Trash2 />
          </button>
        </div>
      )}
    </div>
  );
}
