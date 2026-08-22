import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import { Sheet } from "../../shared/ui/Sheet";
import "./WorkspaceLayout.css";

interface WorkspaceLayoutProps {
  layoutRef: MutableRefObject<HTMLDivElement | null>;
  viewportMode: ViewportMode;
  focus: boolean;
  binderOpen: boolean;
  inspectorOpen: boolean;
  hasCurrent: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  editorBalance: number | null;
  binder: ReactNode;
  inspector: ReactNode;
  editor: ReactNode;
  onBinderOpen: (open: boolean) => void;
  onInspectorOpen: (open: boolean) => void;
  onSidebarWidth?: (width: number) => void;
  onInspectorWidth?: (width: number) => void;
}

export function WorkspaceLayout({
  layoutRef,
  viewportMode,
  focus,
  binderOpen,
  inspectorOpen,
  hasCurrent,
  sidebarWidth,
  inspectorWidth,
  editorBalance,
  binder,
  inspector,
  editor,
  onBinderOpen,
  onInspectorOpen,
  onSidebarWidth,
  onInspectorWidth,
}: WorkspaceLayoutProps) {
  const { t } = useI18n();
  const beginResize = (side: "sidebar" | "inspector", event: ReactPointerEvent) => {
    if (!layoutRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = layoutRef.current.getBoundingClientRect();
    const move = (next: PointerEvent) =>
      side === "sidebar"
        ? onSidebarWidth?.(next.clientX - bounds.left)
        : onInspectorWidth?.(bounds.right - next.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <>
      <div
        ref={layoutRef}
        className={`text-layout ${!binderOpen || focus ? "no-binder" : ""} ${!inspectorOpen || focus || !hasCurrent ? "no-inspector" : ""} ${editorBalance !== null ? "has-balanced-editor" : ""}`}
        style={
          {
            "--workspace-sidebar-width": `${sidebarWidth}px`,
            "--workspace-inspector-width": `${inspectorWidth}px`,
            "--editor-balance-offset": `${Math.round(editorBalance ?? 0)}px`,
          } as React.CSSProperties
        }
      >
        {!focus && viewportMode !== "compact" && !binderOpen && (
          <button
            type="button"
            className="focus-side-toggle panel-edge-toggle panel-edge-toggle--left"
            aria-expanded="false"
            aria-controls="chapter-binder"
            aria-label={t("openNavigation")}
            title={t("openNavigation")}
            onClick={() => onBinderOpen(true)}
          >
            <PanelLeft />
          </button>
        )}
        {!focus && viewportMode !== "compact" && binderOpen && (
          <aside
            id="chapter-binder"
            className="binder drawer-open"
            aria-label={t("chapters")}
            style={{ width: sidebarWidth }}
          >
            {binder}
            {onSidebarWidth && (
              <div
                className="panel-resize-handle panel-resize-handle--end"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeNavigation")}
                aria-valuemin={220}
                aria-valuemax={340}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                onPointerDown={(event) => beginResize("sidebar", event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                    onSidebarWidth(sidebarWidth + (event.key === "ArrowRight" ? 10 : -10));
                }}
              />
            )}
          </aside>
        )}
        {editor}
        {!focus && viewportMode !== "compact" && hasCurrent && !inspectorOpen && (
          <button
            type="button"
            className="focus-helper-toggle panel-edge-toggle panel-edge-toggle--right"
            aria-expanded="false"
            aria-controls="writing-aid-inspector"
            aria-label={t("openWritingAid")}
            title={t("openWritingAid")}
            onClick={() => onInspectorOpen(true)}
          >
            <PanelRight />
          </button>
        )}
        {!focus && viewportMode !== "compact" && inspectorOpen && hasCurrent && (
          <aside
            id="writing-aid-inspector"
            className="inspector drawer-open"
            aria-label={t("writingAid")}
            style={{ width: inspectorWidth }}
          >
            {onInspectorWidth && (
              <div
                className="panel-resize-handle panel-resize-handle--start"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeWritingAid")}
                aria-valuemin={240}
                aria-valuemax={380}
                aria-valuenow={inspectorWidth}
                tabIndex={0}
                onPointerDown={(event) => beginResize("inspector", event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                    onInspectorWidth(inspectorWidth + (event.key === "ArrowLeft" ? 10 : -10));
                }}
              />
            )}
            {inspector}
          </aside>
        )}
      </div>
      {!focus && viewportMode === "compact" && (
        <Sheet open={binderOpen} label={t("chapters")} onClose={() => onBinderOpen(false)}>
          <div id="chapter-binder" className="binder compact-panel">
            {binder}
          </div>
        </Sheet>
      )}
      {!focus && viewportMode === "compact" && hasCurrent && (
        <Sheet open={inspectorOpen} label={t("writingAid")} onClose={() => onInspectorOpen(false)}>
          <div id="writing-aid-inspector" className="inspector compact-panel">
            {inspector}
          </div>
        </Sheet>
      )}
    </>
  );
}
