import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace } from "../types";

export type ViewportMode = "wide" | "regular" | "compact";
export type WorkspaceLayout = {
  navigationOpen: boolean;
  inspectorOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
};

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

export function useWorkspaceLayout(worldId: string | undefined, workspace: Workspace) {
  const mode = useViewportMode();
  const storageKey = useMemo(
    () => (worldId ? `quiltor-layout:${worldId}:${workspace}` : ""),
    [worldId, workspace],
  );
  const [layout, setLayout] = useState<WorkspaceLayout>(() => defaults(viewportMode()));
  useEffect(() => {
    if (!storageKey) {
      setLayout(defaults(mode));
      return;
    }
    try {
      setLayout({ ...defaults(mode), ...JSON.parse(localStorage.getItem(storageKey) || "{}") });
    } catch {
      setLayout(defaults(mode));
    }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [storageKey, layout]);
  useEffect(() => {
    setLayout((current) =>
      mode === "compact"
        ? { ...current, navigationOpen: false, inspectorOpen: false }
        : mode === "regular" && current.navigationOpen && current.inspectorOpen
          ? { ...current, inspectorOpen: false }
          : current,
    );
  }, [mode, storageKey]);

  const setNavigationOpen = useCallback(
    (open: boolean) =>
      setLayout((current) => ({
        ...current,
        navigationOpen: open,
        inspectorOpen: open && mode !== "wide" ? false : current.inspectorOpen,
      })),
    [mode],
  );
  const setInspectorOpen = useCallback(
    (open: boolean) =>
      setLayout((current) => ({
        ...current,
        inspectorOpen: open,
        navigationOpen: open && mode !== "wide" ? false : current.navigationOpen,
      })),
    [mode],
  );
  const setSidebarWidth = useCallback(
    (width: number) =>
      setLayout((current) => ({
        ...current,
        sidebarWidth: Math.max(220, Math.min(340, Math.round(width))),
      })),
    [],
  );
  const setInspectorWidth = useCallback(
    (width: number) =>
      setLayout((current) => ({
        ...current,
        inspectorWidth: Math.max(240, Math.min(380, Math.round(width))),
      })),
    [],
  );
  return { mode, layout, setNavigationOpen, setInspectorOpen, setSidebarWidth, setInspectorWidth };
}
