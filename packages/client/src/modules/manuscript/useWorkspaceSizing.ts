import { useEffect, useRef, useState } from "react";
import type { ViewportMode } from "../../shared";
import { editorBalanceOffset } from "./editorLayout";

interface WorkspaceSizingOptions {
  viewportMode: ViewportMode;
  focus: boolean;
  historyOpen: boolean;
  binderOpen: boolean;
  inspectorOpen: boolean;
  hasCurrent: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
}

export function useWorkspaceSizing({
  viewportMode,
  focus,
  historyOpen,
  binderOpen,
  inspectorOpen,
  hasCurrent,
  sidebarWidth,
  inspectorWidth,
}: WorkspaceSizingOptions) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) setLayoutWidth(element.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    if (typeof ResizeObserver !== "function")
      return () => window.removeEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const editorBalance =
    viewportMode === "wide" && !focus && !historyOpen
      ? editorBalanceOffset(
          layoutWidth,
          binderOpen ? sidebarWidth : 0,
          inspectorOpen && hasCurrent ? inspectorWidth : 0,
        )
      : null;

  return { layoutRef, editorBalance };
}
