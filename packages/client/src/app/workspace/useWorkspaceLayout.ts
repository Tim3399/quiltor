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

export function useWorkspaceLayout(worldId: string | undefined, workspace: Workspace) {
  const mode = useViewportMode();
  const storageKey = useMemo(
    () => (worldId ? `quiltor-layout:${worldId}:${workspace}` : ""),
    [worldId, workspace],
  );
  const [layout, setLayout] = useState<WorkspaceLayout>(() => defaults(viewportMode()));
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads the stored layout only when the key changes; re-running on `mode` would overwrite the viewport adjustment below with the stored layout
  useEffect(() => {
    if (!storageKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate state reset or sync when its trigger changes; moving it into render would change when the update lands
      setLayout(defaults(mode));
      return;
    }
    try {
      setLayout({
        ...defaults(mode),
        ...JSON.parse(quiltorClient.platform.preferences.get(storageKey) || "{}"),
      });
    } catch {
      setLayout(defaults(mode));
    }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey) quiltorClient.platform.preferences.set(storageKey, JSON.stringify(layout));
  }, [storageKey, layout]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `storageKey` is a trigger: a freshly loaded layout must get the viewport constraints applied again
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate state reset or sync when its trigger changes; moving it into render would change when the update lands
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
