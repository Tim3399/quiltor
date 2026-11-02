import { useCallback, useEffect, useMemo, useState } from "react";
import { quiltorClient } from "../../platform";
import type { ViewportMode, Workspace, WorkspaceLayout } from "../../shared";

const defaults = (mode: ViewportMode): WorkspaceLayout => ({
  navigationOpen: mode !== "compact",
  inspectorOpen: mode === "wide",
  sidebarWidth: 246,
  inspectorWidth: 294,
});
const viewportMode = (): ViewportMode =>
  innerWidth < 720 ? "compact" : innerWidth < 1100 ? "regular" : "wide";

export function useViewportMode() {
  const [mode, setMode] = useState<ViewportMode>(viewportMode);
  useEffect(() => {
    const update = () => setMode(viewportMode());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return mode;
}

/** At most one panel beside the text in regular layouts, none in compact ones. */
const constrained = (mode: ViewportMode, layout: WorkspaceLayout): WorkspaceLayout =>
  mode === "compact"
    ? { ...layout, navigationOpen: false, inspectorOpen: false }
    : mode === "regular" && layout.navigationOpen && layout.inspectorOpen
      ? { ...layout, inspectorOpen: false }
      : layout;

const storedLayout = (storageKey: string, mode: ViewportMode): WorkspaceLayout => {
  if (!storageKey) return defaults(mode);
  try {
    return constrained(mode, {
      ...defaults(mode),
      ...JSON.parse(quiltorClient.platform.preferences.get(storageKey) || "{}"),
    });
  } catch {
    return defaults(mode);
  }
};

export function useWorkspaceLayout(worldId: string | undefined, workspace: Workspace) {
  const mode = useViewportMode();
  const storageKey = useMemo(
    () => (worldId ? `quiltor-layout:${worldId}:${workspace}` : ""),
    [worldId, workspace],
  );
  // The stored layout is read while rendering, never in an effect: an effect lands after the
  // first paint, and the text column would show with the default panels and reflow a frame
  // later (T-115).
  const [state, setState] = useState(() => ({
    key: storageKey,
    mode,
    layout: storedLayout(storageKey, mode),
  }));
  let layout = state.layout;
  if (state.key !== storageKey || state.mode !== mode) {
    layout = state.key !== storageKey ? storedLayout(storageKey, mode) : constrained(mode, layout);
    setState({ key: storageKey, mode, layout });
  }
  const setLayout = useCallback(
    (update: (current: WorkspaceLayout) => WorkspaceLayout) =>
      setState((current) => ({ ...current, layout: update(current.layout) })),
    [],
  );
  useEffect(() => {
    if (storageKey) quiltorClient.platform.preferences.set(storageKey, JSON.stringify(layout));
  }, [storageKey, layout]);

  const setNavigationOpen = useCallback(
    (open: boolean) =>
      setLayout((current) => ({
        ...current,
        navigationOpen: open,
        inspectorOpen: open && mode !== "wide" ? false : current.inspectorOpen,
      })),
    [mode, setLayout],
  );
  const setInspectorOpen = useCallback(
    (open: boolean) =>
      setLayout((current) => ({
        ...current,
        inspectorOpen: open,
        navigationOpen: open && mode !== "wide" ? false : current.navigationOpen,
      })),
    [mode, setLayout],
  );
  const setSidebarWidth = useCallback(
    (width: number) =>
      setLayout((current) => ({
        ...current,
        sidebarWidth: Math.max(220, Math.min(340, Math.round(width))),
      })),
    [setLayout],
  );
  const setInspectorWidth = useCallback(
    (width: number) =>
      setLayout((current) => ({
        ...current,
        inspectorWidth: Math.max(240, Math.min(380, Math.round(width))),
      })),
    [setLayout],
  );
  return { mode, layout, setNavigationOpen, setInspectorOpen, setSidebarWidth, setInspectorWidth };
}
