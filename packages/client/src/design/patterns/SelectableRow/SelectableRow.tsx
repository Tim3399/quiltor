import type { ReactNode } from "react";
import { SelectionCard, type SelectionCardProps } from "../SelectionCard";
import "./SelectableRow.css";

export type SelectableRowProps = SelectionCardProps & {
  metadata?: ReactNode;
  density?: "compact" | "regular";
};

export function SelectableRow({
  description,
  metadata,
  density = "compact",
  className = "",
  ...props
}: SelectableRowProps) {
  const detail =
    description || metadata ? (
      <span className="selectable-row__details">
        {description && <span className="selectable-row__description">{description}</span>}
        {metadata && <span className="selectable-row__metadata">{metadata}</span>}
      </span>
    ) : undefined;
  return (
    <SelectionCard
      {...props}
      description={detail}
      className={`selectable-row selectable-row--${density} ${className}`.trim()}
      data-density={density}
    />
  );
}
