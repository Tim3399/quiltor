import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SemanticZoomTier } from "./figures/relationships";
import type { FigureNode } from "./model";

const COMPACT_CARD_HEIGHT = 68;
const COMPACT_CARD_WIDTH = 200;

export function storyNodeCompactLayoutHeight(viewportZoom: number, targetHeight: number): number {
  const safeZoom = safeViewportZoom(viewportZoom);
  return Math.max(COMPACT_CARD_HEIGHT, targetHeight / safeZoom);
}

export function storyNodeCompactLayoutWidth(viewportZoom: number, targetWidth: number): number {
  const safeZoom = safeViewportZoom(viewportZoom);
  return Math.max(COMPACT_CARD_WIDTH, targetWidth / safeZoom);
}

function safeViewportZoom(viewportZoom: number): number {
  return Number.isFinite(viewportZoom) && viewportZoom > 0 ? Math.max(viewportZoom, 0.08) : 1;
}

export interface StoryNodeCardProps extends HTMLAttributes<HTMLDivElement> {
  zoomTier: SemanticZoomTier;
  viewportZoom: number;
  kind?: FigureNode["type"];
  accent?: FigureNode["accent"];
  important?: boolean;
  selected?: boolean;
  dashed?: boolean;
  modifiers?: readonly string[];
}

/** Shared visual surface and state contract for graph node renderers. */
export function StoryNodeCard({
  zoomTier,
  viewportZoom,
  kind = "person",
  accent = "ink",
  important = false,
  selected = false,
  dashed = false,
  modifiers = [],
  className = "",
  style,
  ...props
}: StoryNodeCardProps) {
  const safeZoom = safeViewportZoom(viewportZoom);
  const lodStyle = {
    "--semantic-scale": zoomTier === "overview" ? 1 / safeZoom : 1,
    "--node-compact-height": `${storyNodeCompactLayoutHeight(viewportZoom, 32.5)}px`,
    "--node-compact-touch-height": `${storyNodeCompactLayoutHeight(viewportZoom, 44.5)}px`,
    "--node-compact-width": `${storyNodeCompactLayoutWidth(viewportZoom, 96.5)}px`,
    "--node-compact-font-size": `${14 / safeZoom}px`,
  } as CSSProperties;

  return (
    <div
      {...props}
      style={{ ...lodStyle, ...style }}
      className={[
        "story-node",
        `zoom-${zoomTier}`,
        `type-${kind}`,
        `accent-${accent}`,
        important && "is-important",
        dashed && "dashed",
        selected && "selected",
        ...modifiers,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export interface StoryNodeIdentityProps {
  kindLabel: ReactNode;
  name: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  secondary?: ReactNode;
  children?: ReactNode;
}

/** Shared semantic content structure used by every draggable story node. */
export function StoryNodeIdentity({
  kindLabel,
  name,
  leading,
  trailing,
  secondary,
  children,
}: StoryNodeIdentityProps) {
  const monogram = name.trim().charAt(0).toLocaleUpperCase() || "·";

  return (
    <>
      <span className="node-kind">{kindLabel}</span>
      <span className="node-monogram" aria-hidden="true">
        {monogram}
      </span>
      <strong>
        {leading}
        {name}
        {trailing}
      </strong>
      {secondary && <small>{secondary}</small>}
      {children}
    </>
  );
}
