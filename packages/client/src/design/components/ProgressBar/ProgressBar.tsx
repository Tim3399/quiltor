import type { HTMLAttributes } from "react";
import "./ProgressBar.css";

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  value?: number;
  max?: number;
  showValue?: boolean;
  valueLabel?: string;
}

export function ProgressBar({
  label,
  value,
  max = 100,
  showValue = false,
  valueLabel,
  className = "",
  ...props
}: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const determinate = value !== undefined && Number.isFinite(value);
  const safeValue = determinate ? Math.min(safeMax, Math.max(0, value)) : undefined;
  const percent = safeValue === undefined ? undefined : (safeValue / safeMax) * 100;
  const displayedValue =
    valueLabel ?? (percent === undefined ? undefined : `${Math.round(percent)}%`);
  return (
    <div {...props} className={`progress-component ${className}`.trim()}>
      <div className="progress-component__label">
        <span>{label}</span>
        {showValue && displayedValue && <span>{displayedValue}</span>}
      </div>
      <div
        className="progress-component__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? safeMax : undefined}
        aria-valuenow={safeValue}
        aria-valuetext={valueLabel}
        data-indeterminate={!determinate || undefined}
      >
        <span
          className="progress-component__value"
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
