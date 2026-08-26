import { PanelLeft, PanelRight } from "lucide-react";
import type { MutableRefObject, ReactNode } from "react";
import { AdaptivePanel, IconButton, Sheet, SidePanel } from "../../design";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import { PanelResizeHandle } from "./PanelResizeHandle";
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
          <IconButton
            className="focus-side-toggle panel-edge-toggle panel-edge-toggle--left"
            aria-expanded="false"
            aria-controls="chapter-binder"
            title={t("openNavigation")}
            onClick={() => onBinderOpen(true)}
            label={t("openNavigation")}
            icon={<PanelLeft />}
          />
        )}
        <AdaptivePanel
          open={!focus && viewportMode !== "compact" && binderOpen}
          presentation="inline"
          label={t("chapters")}
          closeLabel={t("closeNavigation")}
          onClose={() => onBinderOpen(false)}
          renderInline={({ children }) => (
            <SidePanel
              id="chapter-binder"
              className="manuscript-binder-panel drawer-open"
              label={t("chapters")}
              side="start"
              style={{ width: sidebarWidth }}
            >
              {children}
              {onSidebarWidth && (
                <PanelResizeHandle
                  containerRef={layoutRef}
                  edge="end"
                  label={t("resizeNavigation")}
                  min={220}
                  max={340}
                  value={sidebarWidth}
                  onChange={onSidebarWidth}
                />
              )}
            </SidePanel>
          )}
        >
          {binder}
        </AdaptivePanel>
        {editor}
        {!focus && viewportMode !== "compact" && hasCurrent && !inspectorOpen && (
          <IconButton
            className="focus-helper-toggle panel-edge-toggle panel-edge-toggle--right"
            aria-expanded="false"
            aria-controls="writing-aid-inspector"
            title={t("openWritingAid")}
            onClick={() => onInspectorOpen(true)}
            label={t("openWritingAid")}
            icon={<PanelRight />}
          />
        )}
        <AdaptivePanel
          open={!focus && viewportMode !== "compact" && inspectorOpen && hasCurrent}
          presentation="inline"
          label={t("writingAid")}
          closeLabel={t("closeWritingAid")}
          onClose={() => onInspectorOpen(false)}
          renderInline={({ children }) => (
            <SidePanel
              id="writing-aid-inspector"
              className="manuscript-inspector-panel drawer-open"
              label={t("writingAid")}
              style={{ width: inspectorWidth }}
            >
              {onInspectorWidth && (
                <PanelResizeHandle
                  containerRef={layoutRef}
                  edge="start"
                  label={t("resizeWritingAid")}
                  min={240}
                  max={380}
                  value={inspectorWidth}
                  onChange={onInspectorWidth}
                />
              )}
              {children}
            </SidePanel>
          )}
        >
          {inspector}
        </AdaptivePanel>
      </div>
      <AdaptivePanel
        open={!focus && viewportMode === "compact" && binderOpen}
        presentation="overlay"
        label={t("chapters")}
        closeLabel={t("closeNavigation")}
        onClose={() => onBinderOpen(false)}
        renderOverlay={({ children }) => (
          <Sheet open label={t("chapters")} onClose={() => onBinderOpen(false)}>
            <SidePanel
              id="chapter-binder"
              className="manuscript-binder-panel manuscript-compact-panel"
              label={t("chapters")}
              side="start"
              width="fill"
            >
              {children}
            </SidePanel>
          </Sheet>
        )}
      >
        {binder}
      </AdaptivePanel>
      <AdaptivePanel
        open={!focus && viewportMode === "compact" && hasCurrent && inspectorOpen}
        presentation="overlay"
        label={t("writingAid")}
        closeLabel={t("closeWritingAid")}
        onClose={() => onInspectorOpen(false)}
        renderOverlay={({ children }) => (
          <Sheet open label={t("writingAid")} onClose={() => onInspectorOpen(false)}>
            <SidePanel
              id="writing-aid-inspector"
              className="manuscript-inspector-panel manuscript-compact-panel"
              label={t("writingAid")}
              width="fill"
            >
              {children}
            </SidePanel>
          </Sheet>
        )}
      >
        {inspector}
      </AdaptivePanel>
    </>
  );
}
