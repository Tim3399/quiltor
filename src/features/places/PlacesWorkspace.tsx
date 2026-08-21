import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useUpdateNodeInternals,
} from "@xyflow/react";
import {
  Copy,
  MapPin,
  MoreHorizontal,
  Pin,
  Plus,
  Redo2,
  Ruler,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLanguage } from "../../language";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Menu, MenuItem, MenuSeparator } from "../../shared/ui/Menu";
import { Popover } from "../../shared/ui/Popover";
import { Sheet } from "../../shared/ui/Sheet";
import { Inspector } from "../../shared/ui/Sidebar";
import { useShortcut } from "../../shared/ui/shortcuts";
import type { FigureNode, FigureState, TimelineMoment, Workspace } from "../../types";
import { uid } from "../../types";
import {
  type PlaceMomentRow,
  type PlaceStay,
  placeChronicle,
  placeJourney,
  stopDateDiff,
} from "../figures/presence";
import { GRID_SIZE, type SemanticZoomTier, semanticZoomTier } from "../figures/relationships";
import { formatDistance, mapDistancePair, nearestMapDistances } from "./placeMap";
import "./PlacesWorkspace.css";

type PlaceCardData = {
  place: FigureNode;
  measuring: boolean;
  measureStart: boolean;
  zoomTier: SemanticZoomTier;
  zoom: number;
};
const nodeTypes = { place: OrtNode };
const placeCoordinateHandleStyle = {
  top: 6,
  right: "auto",
  bottom: "auto",
  left: 6,
  transform: "translate(-50%, -50%)",
} satisfies CSSProperties;

function OrtNode({ data, selected }: NodeProps<Node<PlaceCardData>>) {
  const { t } = useLanguage();
  const item = data.place;
  const semanticScale = data.zoomTier === "overview" ? 1 / Math.max(data.zoom, 0.08) : 1;
  return (
    <div className="place-node-shell">
      <Handle
        id="place-anchor"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <Handle
        id="place-anchor"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="place-coordinate-handle"
        style={placeCoordinateHandleStyle}
      />
      <div
        style={{ "--semantic-scale": semanticScale } as CSSProperties}
        className={`story-node zoom-${data.zoomTier} type-ort accent-${item.accent || "ink"} ${item.important ? "is-important" : ""} ${data.measuring ? "is-measuring" : ""} ${data.measureStart ? "is-measure-start" : ""} ${selected ? "selected" : ""}`}
      >
        <span className="node-kind">{t("place")}</span>
        <strong>
          {item.important && (
            <Star className="importance-mark" aria-label={t("favoritePlaceMarker")} />
          )}
          {item.name}
        </strong>
        {item.sub && <small>{item.sub}</small>}
      </div>
    </div>
  );
}

function placePosition(place: FigureNode) {
  return { x: place.mapX ?? place.x, y: place.mapY ?? place.y };
}

type PlacesWorkspaceProps = {
  state: FigureState;
  onChange: (value: FigureState) => void;
  targetId?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
};

export function PlacesWorkspace(props: PlacesWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <PlacesWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}

function PlacesWorkspaceInner({
  state,
  onChange,
  targetId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpen,
}: PlacesWorkspaceProps) {
  const { t } = useLanguage();
  const keys = useShortcut();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measureSelection, setMeasureSelection] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deletePlace, setDeletePlace] = useState<FigureNode | null>(null);
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  const [zoomTier, setZoomTier] = useState<SemanticZoomTier>("detail");
  const [viewportZoom, setViewportZoom] = useState(1);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const flow = useRef<ReactFlowInstance<Node<PlaceCardData>, Edge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const latestState = useRef(state);
  latestState.current = state;

  const places = useMemo(() => state.nodes.filter((node) => node.type === "ort"), [state.nodes]);
  const timeline = state.timeline || [];
  const presence = state.presence || [];
  const selected = places.find((place) => place.id === selectedId) || null;

  const selectPlace = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (!measuring) return;
      setMeasureSelection((current) =>
        current.length === 1 && current[0] !== id ? [current[0], id] : [id],
      );
    },
    [measuring],
  );
  const selectPlaceFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = target.closest<HTMLElement>(".react-flow__node[data-id]");
      const id = node?.dataset.id;
      if (!id || !event.currentTarget.contains(node)) return;
      event.preventDefault();
      selectPlace(id);
    },
    [selectPlace],
  );

  useEffect(() => {
    if (!targetId) return;
    const item = latestState.current.nodes.find(
      (node) => node.id === targetId && node.type === "ort",
    );
    if (item) {
      setSelectedId(targetId);
      const position = placePosition(item);
      setTimeout(
        () => flow.current?.setCenter(position.x, position.y, { zoom: 1, duration: 350 }),
        0,
      );
    }
  }, [targetId]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 719px)"),
      update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!measuring) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMeasuring(false);
        setMeasureSelection([]);
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [measuring]);

  const derivedNodes = useMemo<Node<PlaceCardData>[]>(
    () =>
      places.map((place) => ({
        id: place.id,
        type: "place",
        position: placePosition(place),
        draggable: !place.pinned,
        ariaLabel: t("placeNodeLabel", { name: place.name }),
        ariaRole: "button",
        data: {
          place,
          measuring,
          measureStart:
            measuring && measureSelection.length === 1 && measureSelection[0] === place.id,
          zoomTier,
          zoom: viewportZoom,
        },
      })),
    [places, measuring, measureSelection, t, zoomTier, viewportZoom],
  );
  const [nodes, setFlowNodes] = useState<Node<PlaceCardData>[]>(derivedNodes);
  useEffect(() => setFlowNodes(derivedNodes), [derivedNodes]);

  const moveNodes = useCallback((changes: NodeChange<Node<PlaceCardData>>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const commitPlacePosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      const current = latestState.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, mapX: position.x, mapY: position.y } : node,
        ),
      };
      latestState.current = next;
      onChange(next);
      window.requestAnimationFrame(() => updateNodeInternals([id]));
    },
    [onChange, updateNodeInternals],
  );

  const measureEdges = useMemo<Edge[]>(() => {
    if (!measuring) return [];
    const points = nodes.map((node) => ({
      id: node.id,
      mapX: node.position.x,
      mapY: node.position.y,
    }));
    const pairs = new Map(nearestMapDistances(points).map((pair) => [pair.id, pair]));
    const from = points.find((point) => point.id === measureSelection[0]);
    const to = points.find((point) => point.id === measureSelection[1]);
    const targeted = from && to ? mapDistancePair(from, to) : null;
    if (targeted) pairs.set(targeted.id, targeted);

    const names = new Map(nodes.map((node) => [node.id, node.data.place.name]));
    return [...pairs.values()].map((pair) => {
      const distance = formatDistance(pair.distance, t, state.mapScale);
      return {
        id: pair.id,
        source: pair.from,
        target: pair.to,
        sourceHandle: "place-anchor",
        targetHandle: "place-anchor",
        type: "straight",
        label: distance,
        ariaLabel: t("distanceEdgeLabel", {
          from: names.get(pair.from) ?? pair.from,
          to: names.get(pair.to) ?? pair.to,
          distance,
        }),
        labelBgStyle: { fill: "var(--edge-label-bg)" },
        labelStyle: { fill: "var(--edge-label-text)" },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        selectable: false,
        focusable: false,
        className: pair.id === targeted?.id ? "distance-edge is-targeted" : "distance-edge",
      } satisfies Edge;
    });
  }, [measuring, measureSelection, nodes, state.mapScale, t]);

  const stays = useMemo(
    () => (selected ? placeJourney(selected.id, state.nodes, presence, timeline) : []),
    [selected, state.nodes, presence, timeline],
  );
  const chronicle = useMemo(
    () => (selected ? placeChronicle(selected.id, state.nodes, presence, timeline) : []),
    [selected, state.nodes, presence, timeline],
  );

  const patchScale = (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) =>
    onChange({
      ...state,
      mapScale: { unitsPer100px: 1, unitLabel: t("unitsDefault"), ...state.mapScale, ...patch },
    });
  const addPlace = () => {
    const center = flow.current?.screenToFlowPosition({
      x: innerWidth / 2,
      y: innerHeight / 2,
    }) ?? { x: 240, y: 180 };
    const place: FigureNode = {
      id: uid("n"),
      type: "ort",
      name: t("newPlace"),
      label: t("place"),
      sub: "",
      x: center.x,
      y: center.y,
      mapX: center.x,
      mapY: center.y,
      accent: "ink",
      profile: { extra: [] },
    };
    onChange({ ...state, nodes: [...state.nodes, place] });
    setSelectedId(place.id);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copy: FigureNode = {
      ...selected,
      id: uid("n"),
      name: t("copyName", { name: selected.name }),
      x: selected.x + GRID_SIZE,
      y: selected.y + GRID_SIZE,
      mapX: placePosition(selected).x + GRID_SIZE,
      mapY: placePosition(selected).y + GRID_SIZE,
    };
    onChange({ ...state, nodes: [...state.nodes, copy] });
    setSelectedId(copy.id);
    setActionsOpen(false);
  };
  const removePlace = () => {
    if (!deletePlace) return;
    const nodes = state.nodes.filter((node) => node.id !== deletePlace.id);
    onChange({
      ...state,
      nodes,
      edges: state.edges.filter(
        (edge) => edge.from !== deletePlace.id && edge.to !== deletePlace.id,
      ),
      presence: presence.filter((entry) => entry.placeId !== deletePlace.id),
    });
    setSelectedId(null);
    setDeletePlace(null);
  };
  const patchSelected = (patch: Partial<FigureNode>) =>
    selected &&
    onChange({
      ...state,
      nodes: state.nodes.map((node) => (node.id === selected.id ? { ...node, ...patch } : node)),
    });
  const inspectorContent = (
    <>
      <div className="panel-heading">
        <span>{selected ? selected.name : t("inspector")}</span>
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
          <MapPin />
          <h2>{t("selectPlace")}</h2>
          <p>{t("selectPlaceBody")}</p>
        </div>
      ) : (
        <>
          <div className="panel-body places-place-fields">
            <label className="field">
              <span>{t("name")}</span>
              <input
                value={selected.name}
                onChange={(event) => patchSelected({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("shortDescription")}</span>
              <textarea
                value={selected.sub || ""}
                onChange={(event) => patchSelected({ sub: event.target.value })}
              />
            </label>
            <div className="node-priority-actions">
              <button
                type="button"
                className={selected.important ? "active" : ""}
                aria-pressed={!!selected.important}
                onClick={() => patchSelected({ important: !selected.important })}
              >
                <Star />
                {selected.important ? t("unfavoritePlace") : t("favoritePlace")}
              </button>
              <button
                type="button"
                className={selected.pinned ? "active" : ""}
                aria-pressed={!!selected.pinned}
                onClick={() => patchSelected({ pinned: !selected.pinned })}
              >
                <Pin />
                {selected.pinned ? t("unlockPlacePosition") : t("lockPlacePosition")}
              </button>
            </div>
          </div>
          <PlaceInspector
            place={selected}
            nodes={state.nodes}
            stays={stays}
            chronicle={chronicle}
            timeline={timeline}
            onOpen={onOpen}
          />
        </>
      )}
    </>
  );

  return (
    <section className="places-workspace" aria-label={t("placesLabel")}>
      <div className="context-bar">
        <div className="context-title">
          <strong>{t("places")}</strong>
          <span>{t("nPlaces").replace("{n}", String(places.length))}</span>
        </div>
        <div className="tool-group">
          <button className="primary" onClick={addPlace}>
            <Plus />
            {t("newPlace")}
          </button>
        </div>
        <div className="tool-group">
          <button
            aria-pressed={measuring}
            className={measuring ? "active" : ""}
            onClick={() => {
              setMeasuring((value) => !value);
              setMeasureSelection([]);
            }}
          >
            <Ruler />
            {t("measureDistance")}
          </button>
        </div>
        <div className="tool-group">
          <button
            disabled={!canUndo}
            onClick={onUndo}
            aria-label={t("undoPlaces")}
            title={`${t("undoPlaces")} · ${keys("Z")}`}
          >
            <Undo2 />
          </button>
          <button
            disabled={!canRedo}
            onClick={onRedo}
            aria-label={t("redoPlaces")}
            title={`${t("redoPlaces")} · ${keys("Z", { shift: true })}`}
          >
            <Redo2 />
          </button>
        </div>
        <div className="tool-group">
          <button
            ref={actionsButton}
            disabled={!selected}
            aria-label={t("placeActions")}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((value) => !value)}
          >
            <MoreHorizontal />
          </button>
          <Popover
            anchorRef={actionsButton}
            open={actionsOpen}
            onClose={() => setActionsOpen(false)}
            label={t("placeActions")}
          >
            <Menu label={t("placeActions")} onClose={() => setActionsOpen(false)}>
              <MenuItem onSelect={duplicateSelected}>
                <Copy />
                {t("duplicatePlace")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  setDeletePlace(selected);
                  setActionsOpen(false);
                }}
              >
                <Trash2 />
                {t("deletePlace")}
              </MenuItem>
            </Menu>
          </Popover>
        </div>
      </div>
      <div className="figure-layout">
        <div
          className={`flow-area places-flow-area zoom-${zoomTier} ${measuring ? "is-connecting" : ""}`}
        >
          {measuring && (
            <div className="places-measure-overlays">
              <div className="mode-banner" role="status">
                <Ruler />
                <span>
                  {measureSelection.length === 1
                    ? t("selectDistanceTargetHint")
                    : t("nearestDistancesHint")}
                </span>
                <button
                  onClick={() => {
                    setMeasuring(false);
                    setMeasureSelection([]);
                  }}
                >
                  <X />
                  <span className="sr-only">{t("stopMeasuring")}</span>
                </button>
              </div>
              <div className="places-scale-legend">
                <label>
                  <span>{t("scale")}</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={state.mapScale?.unitsPer100px ?? 1}
                    onChange={(event) =>
                      patchScale({ unitsPer100px: Number(event.target.value) || 1 })
                    }
                  />
                  <span>{t("perHundredPx")}</span>
                </label>
                <label>
                  <span className="sr-only">{t("unitLabelField")}</span>
                  <input
                    value={state.mapScale?.unitLabel ?? t("unitsDefault")}
                    onChange={(event) => patchScale({ unitLabel: event.target.value })}
                  />
                </label>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={measureEdges}
            nodeTypes={nodeTypes}
            nodesConnectable={true}
            onKeyDown={selectPlaceFromKeyboard}
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
            onNodeClick={(_, node) => selectPlace(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodesChange={moveNodes}
            onNodeDragStop={(_, node) => commitPlacePosition(node.id, node.position)}
            fitView
            minZoom={0.08}
            maxZoom={2.2}
            deleteKeyCode={null}
          >
            {zoomTier !== "overview" && (
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
              nodeColor={() => "var(--minimap-place)"}
              maskColor="var(--minimap-mask)"
            />
          </ReactFlow>
          {!places.length && (
            <div className="places-manager-empty">
              <MapPin />
              <h2>{t("noPlacesYet")}</h2>
              <p>{t("noPlacesYetBody")}</p>
            </div>
          )}
        </div>
        {!compact && (
          <Inspector
            className={`inspector places-inspector ${selected ? "has-selection" : ""}`}
            aria-label={t("placesInspectorLabel")}
          >
            {inspectorContent}
          </Inspector>
        )}
      </div>
      {compact && selected && !measuring && (
        <Sheet open label={t("placesInspectorLabel")} onClose={() => setSelectedId(null)}>
          {inspectorContent}
        </Sheet>
      )}
      {deletePlace && (
        <ConfirmDialog
          title={t("deletePlace")}
          description={t("deletePlaceDescription", { name: deletePlace.name })}
          confirmLabel={t("deletePlace")}
          undoable
          onClose={() => setDeletePlace(null)}
          onConfirm={removePlace}
        />
      )}
    </section>
  );
}

function PlaceInspector({
  nodes,
  stays,
  chronicle,
  timeline,
  onOpen,
}: {
  place: FigureNode;
  nodes: FigureNode[];
  stays: PlaceStay[];
  chronicle: PlaceMomentRow[];
  timeline: TimelineMoment[];
  onOpen: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="panel-body places-inspector-body">
      <details className="places-manager-section" open>
        <summary>
          <div>
            <h2>{t("whoWasHere")}</h2>
            <p>{t("whoWasHereBody")}</p>
          </div>
        </summary>
        <div className="places-stay-table">
          {stays.map((stay, index) => {
            const figure = nodes.find((node) => node.id === stay.elementId);
            if (!figure) return null;
            return (
              <div key={`${stay.elementId}-${index}`}>
                <button
                  className="places-link"
                  onClick={() => onOpen({ workspace: "figures", id: figure.id })}
                >
                  {figure.name}
                </button>
                <span>
                  {stay.arrivedAt.momentId
                    ? timeline.find((moment) => moment.id === stay.arrivedAt.momentId)?.title
                    : t("initialState")}
                </span>
                <span>
                  {stay.leftAt
                    ? stay.died
                      ? `† ${timeline.find((moment) => moment.id === stay.leftAt?.momentId)?.title ?? ""}`
                      : timeline.find((moment) => moment.id === stay.leftAt?.momentId)?.title
                    : t("stillHere")}
                </span>
                <span className="places-stay-duration">
                  {stay.leftAt ? stopDateDiff(stay.arrivedAt, stay.leftAt, timeline).label : ""}
                </span>
              </div>
            );
          })}
          {!stays.length && <p className="places-section-empty">{t("noOneHereYet")}</p>}
        </div>
      </details>
      <details className="places-manager-section" open>
        <summary>
          <div>
            <h2>{t("chronicle")}</h2>
            <p>{t("chronicleBody")}</p>
          </div>
        </summary>
        <div className="places-chronicle-list">
          {chronicle.map((row) => (
            <div key={row.index}>
              <strong>
                {row.moment ? (
                  <button
                    className="places-link"
                    onClick={() => onOpen({ workspace: "timeline", id: row.moment!.id })}
                  >
                    {row.moment.title}
                  </button>
                ) : (
                  t("initialState")
                )}
              </strong>
              <span>
                {row.occupants.length
                  ? row.occupants.map((node) => node.name).join(", ")
                  : t("nobodyHere")}
              </span>
              {!!row.arrived.length && (
                <small>
                  {t("arrived")}: {row.arrived.map((node) => node.name).join(", ")}
                </small>
              )}
              {!!row.left.length && (
                <small>
                  {t("left")}: {row.left.map((node) => node.name).join(", ")}
                </small>
              )}
            </div>
          ))}
          {!chronicle.length && <p className="places-section-empty">{t("noMovementYet")}</p>}
        </div>
      </details>
    </div>
  );
}
