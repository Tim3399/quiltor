import { AlertCircle, Check, CloudOff, LoaderCircle } from "lucide-react";
import type { HTMLAttributes } from "react";
import { Button } from "../../primitives/Button";
import "./SaveStatus.css";

export type SaveStatusPhase = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  phase: SaveStatusPhase;
  label: string;
  labelVisibility?: "always" | "attention";
  error?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function SaveStatus({
  phase,
  label,
  labelVisibility = "always",
  error,
  retryLabel,
  onRetry,
  className = "",
  ...props
}: SaveStatusProps) {
  const Icon =
    phase === "error"
      ? CloudOff
      : phase === "saving"
        ? LoaderCircle
        : phase === "dirty"
          ? AlertCircle
          : Check;
  return (
    <div
      {...props}
      className={`save-status-component save-status-component--${phase} ${className}`.trim()}
      data-phase={phase}
      data-label-visibility={labelVisibility}
      role={phase === "error" ? "alert" : "status"}
      aria-live={phase === "error" ? "assertive" : "polite"}
      aria-busy={phase === "saving" || undefined}
    >
      <span className="save-status-component__state">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </span>
      {error && <span className="save-status-component__detail">{error}</span>}
      {phase === "error" && onRetry && retryLabel && (
        <Button
          className="save-status-component__retry"
          appearance="ghost"
          tone="danger"
          size="compact"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
