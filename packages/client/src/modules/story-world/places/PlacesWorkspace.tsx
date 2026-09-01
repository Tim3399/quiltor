import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, Sheet, SidePanel } from "../../../design";
import { useI18n } from "../../../i18n";
import { quiltorClient } from "../../../platform";
import type { Workspace } from "../../../shared";
import type { FigureNode, FigureState } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { PlaceCanvas } from "./PlaceCanvas";
import { PlaceInspector } from "./PlaceInspector";
import { levelTrail, placesOnLevel, scaleForLevel } from "./placeLevels";
import { DEFAULT_MAP_WIDTH } from "./placeCanvasModel";
import { askForMapImage, prepareMapImage } from "./placeMapUpload";
import { PlaceToolbar } from "./PlaceToolbar";
import { usePlaceCanvas } from "./usePlaceCanvas";
import "./PlacesWorkspace.css";

export type PlacesWorkspaceProps = {
  state: FigureState;
  onChange: (value: FigureState) => void;
  targetId?: string;
  targetRequestId?: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
};

/** Mirrors StoryGraph.css, where the inspector column collapses at 820px. */
export const PLACE_COMPACT_MEDIA_QUERY = "(max-width: 820px)";

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
  targetRequestId,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpen,
}: PlacesWorkspaceProps) {
  const { locale, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which level is open. The trail below is derived from the parent pointers
  // rather than remembered while descending, so arriving from a search result or
  // a backlink still shows where a place really sits.
  const [levelId, setLevelId] = useState<string | undefined>(undefined);
  const [measuring, setMeasuring] = useState(false);
  const [measureSelection, setMeasureSelection] = useState<string[]>([]);
  const [deletePlace, setDeletePlace] = useState<FigureNode | null>(null);
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia(PLACE_COMPACT_MEDIA_QUERY).matches,
  );
  const latestState = useRef(state);
  latestState.current = state;

  const places = useMemo(() => placesOnLevel(state.nodes, levelId), [state.nodes, levelId]);
  const trail = useMemo(() => levelTrail(state.nodes, levelId), [state.nodes, levelId]);
  const levelScale = useMemo(
    () => scaleForLevel(state.nodes, levelId, state.mapScale),
    [state.nodes, levelId, state.mapScale],
  );
  const openLevel = useCallback((place: FigureNode) => {
    setLevelId(place.id);
    setSelectedId(null);
    setMeasureSelection([]);
  }, []);
  const goToLevel = useCallback((nextLevelId: string | undefined) => {
    setLevelId(nextLevelId);
    setSelectedId(null);
    setMeasureSelection([]);
  }, []);
  // A level that vanished -- undone, or deleted with its contents -- would leave
  // the surface showing nothing and no way back. Fall out to the root instead.
  useEffect(() => {
    if (!levelId) return;
    if (!state.nodes.some((node) => node.id === levelId && node.type === "ort"))
      setLevelId(undefined);
  }, [state.nodes, levelId]);
  const selected = places.find((place) => place.id === selectedId) ?? null;
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
  const mapImageUrl = useCallback(
    (imageId: string) => quiltorClient.application.placeMaps.sourceUrl(imageId),
    [],
  );
  const patchPlace = useCallback(
    (placeId: string, patch: Partial<FigureNode>) => {
      const current = latestState.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) => (node.id === placeId ? { ...node, ...patch } : node)),
      };
      latestState.current = next;
      onChange(next);
    },
    [onChange],
  );

  const collapseMap = useCallback(
    (place: FigureNode) => patchPlace(place.id, { mapExpanded: false }),
    [patchPlace],
  );
  const expandMap = useCallback(
    (place: FigureNode) => patchPlace(place.id, { mapExpanded: true }),
    [patchPlace],
  );

  const canvas = usePlaceCanvas({
    state,
    places,
    levelId,
    measuring,
    measureSelection,
    onOpenLevel: openLevel,
    mapImageUrl,
    onCollapseMap: collapseMap,
    onExpandMap: expandMap,
    onChange,
  });

  /**
   * A new map: a place that arrives opened out, with its picture already on it.
   *
   * It is the same kind of thing as a place -- collapsing turns it into a card
   * you can dive into -- which is why creating one adds a node rather than
   * hanging a picture on the level you happen to be standing on.
   */
  const addMap = useCallback(async () => {
    const file = await askForMapImage();
    if (!file) return;
    const prepared = await prepareMapImage(file);
    const stored = await quiltorClient.application.placeMaps.store(prepared);
    const created = canvas.addPlace();
    patchPlace(created.id, {
      name: t("newMap"),
      mapImageId: stored.id,
      mapExpanded: true,
      // The stored pixels set the shape; the surface is measured in flow units.
      mapWidth: DEFAULT_MAP_WIDTH,
      mapHeight: Math.max(1, Math.round((DEFAULT_MAP_WIDTH * stored.height) / stored.width)),
    });
    setSelectedId(created.id);
  }, [canvas, patchPlace, t]);

  const centerOnPlace = useRef(canvas.centerOnPlace);
  centerOnPlace.current = canvas.centerOnPlace;

  useEffect(() => {
    // The ID is an event identity: a newer request must replay selection even when its target is
    // textually identical to the previous request.
    void targetRequestId;
    if (!targetId) return;
    const item = latestState.current.nodes.find(
      (node) => node.id === targetId && node.type === "ort",
    );
    if (!item) return;
    // The target may sit on another level; showing it means going there first.
    setLevelId(item.parentPlaceId);
    setSelectedId(targetId);
    centerOnPlace.current(item);
  }, [targetId, targetRequestId]);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(PLACE_COMPACT_MEDIA_QUERY);
    const updateCompact = () => setCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);
  useEffect(() => {
    if (!measuring) return;
    const closeMeasurement = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMeasuring(false);
      setMeasureSelection([]);
    };
    document.addEventListener("keydown", closeMeasurement);
    return () => document.removeEventListener("keydown", closeMeasurement);
  }, [measuring]);

  const stopMeasuring = () => {
    setMeasuring(false);
    setMeasureSelection([]);
  };
  const patchSelected = (patch: Partial<FigureNode>) => {
    if (!selected) return;
    onChange({
      ...state,
      nodes: state.nodes.map((node) => (node.id === selected.id ? { ...node, ...patch } : node)),
    });
  };
  const patchScale = (patch: Partial<{ unitsPer100px: number; unitLabel: string }>) =>
    onChange({
      ...state,
      mapScale: { unitsPer100px: 1, unitLabel: t("unitsDefault"), ...state.mapScale, ...patch },
    });
  const removePlace = () => {
    if (!deletePlace) return;
    onChange({
      ...state,
      nodes: state.nodes.filter((node) => node.id !== deletePlace.id),
      edges: state.edges.filter(
        (edge) => edge.from !== deletePlace.id && edge.to !== deletePlace.id,
      ),
      presence: (state.presence ?? []).filter((entry) => entry.placeId !== deletePlace.id),
    });
    setSelectedId(null);
    setDeletePlace(null);
  };

  const inspectorContent = (
    <PlaceInspector
      selected={selected}
      state={state}
      onPatch={patchSelected}
      onClose={() => setSelectedId(null)}
      onOpen={onOpen}
    />
  );

  return (
    <section className="places-workspace" aria-label={t("placesLabel")}>
      <PlaceToolbar
        placesCount={places.length}
        selected={selected}
        measuring={measuring}
        canUndo={canUndo}
        canRedo={canRedo}
        onAdd={() => setSelectedId(canvas.addPlace().id)}
        onAddMap={addMap}
        onMeasuringToggle={() => {
          setMeasuring((value) => !value);
          setMeasureSelection([]);
        }}
        onUndo={onUndo}
        onRedo={onRedo}
        onDuplicate={() => {
          if (selected) setSelectedId(canvas.duplicatePlace(selected).id);
        }}
        onDelete={() => setDeletePlace(selected)}
      />
      <div className={`figure-layout${places.length ? "" : " places-layout-empty"}`}>
        <PlaceCanvas
          controller={canvas}
          placesCount={places.length}
          measuring={measuring}
          measureSelection={measureSelection}
          scale={levelScale}
          trail={trail}
          onGoToLevel={goToLevel}
          onSelectPlace={selectPlace}
          onClearSelection={() => setSelectedId(null)}
          onStopMeasuring={stopMeasuring}
          onScale={patchScale}
        />
        {!compact && !!places.length && (
          <SidePanel
            className={`places-inspector ${selected ? "has-selection" : ""}`}
            label={t("placesInspectorLabel")}
          >
            {inspectorContent}
          </SidePanel>
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
          supportingText={t("undoHint", { shortcut: storyShortcutLabel("Z", locale) })}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deletePlace")}
          onClose={() => setDeletePlace(null)}
          onConfirm={removePlace}
        />
      )}
    </section>
  );
}
