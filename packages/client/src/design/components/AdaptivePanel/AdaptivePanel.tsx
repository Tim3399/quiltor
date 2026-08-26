import { useRef, type ReactNode } from "react";
import { useOverlayFocus } from "../../internal/useOverlayFocus";
import { IconButton } from "../../primitives/IconButton";
import { SidePanel, SidePanelBody, SidePanelHeader, type SidePanelProps } from "../SidePanel";
import "./AdaptivePanel.css";

export type AdaptivePanelPresentation = "inline" | "overlay";

export type AdaptivePanelRenderContext = {
  label: string;
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

export interface AdaptivePanelProps {
  open: boolean;
  presentation: AdaptivePanelPresentation;
  label: string;
  title?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  side?: SidePanelProps["side"];
  renderInline?: (context: AdaptivePanelRenderContext) => ReactNode;
  renderOverlay?: (context: AdaptivePanelRenderContext) => ReactNode;
}

export function AdaptivePanel({
  open,
  presentation,
  label,
  title = label,
  closeLabel,
  onClose,
  children,
  side = "end",
  renderInline,
  renderOverlay,
}: AdaptivePanelProps) {
  const overlay = useRef<HTMLElement>(null);
  const context = { label, title, closeLabel, onClose, children };
  useOverlayFocus(overlay, open && presentation === "overlay" && !renderOverlay, onClose);

  if (!open) return null;
  if (presentation === "inline") {
    if (renderInline) return renderInline(context);
    return (
      <SidePanel label={label} side={side}>
        <SidePanelHeader
          title={title}
          actions={
            <IconButton
              label={closeLabel}
              icon={<span aria-hidden="true">×</span>}
              onClick={onClose}
              size="touch"
            />
          }
        />
        <SidePanelBody>{children}</SidePanelBody>
      </SidePanel>
    );
  }
  if (renderOverlay) return renderOverlay(context);

  return (
    <div
      className="adaptive-panel__backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        ref={overlay}
        className="adaptive-panel__overlay"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <SidePanelHeader
          title={title}
          actions={
            <IconButton
              data-autofocus
              label={closeLabel}
              icon={<span aria-hidden="true">×</span>}
              onClick={onClose}
              size="touch"
            />
          }
        />
        <SidePanelBody>{children}</SidePanelBody>
      </aside>
    </div>
  );
}
