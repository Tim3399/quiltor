import type { HTMLAttributes } from "react";
import type { SemanticZoomTier } from "./figures/relationships";
import type { FigureNode } from "./model";

export interface StoryNodeCardProps extends HTMLAttributes<HTMLDivElement> {
  zoomTier: SemanticZoomTier;
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
  kind = "person",
  accent = "ink",
  important = false,
  selected = false,
  dashed = false,
  modifiers = [],
  className = "",
  ...props
}: StoryNodeCardProps) {
  return (
    <div
      {...props}
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
