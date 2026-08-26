import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, Sheet, SidePanel } from "../../../design";
import { useI18n } from "../../../i18n";
import type { Workspace } from "../../../shared";
import type { FigureNode, FigureState } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { PlaceCanvas } from "./PlaceCanvas";
import { PlaceInspector } from "./PlaceInspector";
import { PlaceToolbar } from "./PlaceToolbar";
import { usePlaceCanvas } from "./usePlaceCanvas";
import "./PlacesWorkspace.css";

export type PlacesWorkspaceProps = {
  state: FigureState;
  onChange: (value: FigureState) => void;
  targetId?: string;
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
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpen,
}: PlacesWorkspaceProps) {
  const { locale, t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measureSelection, setMeasureSelection] = useState<string[]>([]);
  const [deletePlace, setDeletePlace] = useState<FigureNode | null>(null);
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia(PLACE_COMPACT_MEDIA_QUERY).matches,
  );
  const latestState = useRef(state);
  latestState.current = state;

  const places = useMemo(() => state.nodes.filter((node) => node.type === "ort"), [state.nodes]);
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
  const canvas = usePlaceCanvas({ state, places, measuring, measureSelection, onChange });
  const centerOnPlace = useRef(canvas.centerOnPlace);
  centerOnPlace.current = canvas.centerOnPlace;

  useEffect(() => {
    if (!targetId) return;
    const item = latestState.current.nodes.find(
      (node) => node.id === targetId && node.type === "ort",
    );
    if (!item) return;
    setSelectedId(targetId);
    centerOnPlace.current(item);
  }, [targetId]);
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
          scale={state.mapScale}
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
