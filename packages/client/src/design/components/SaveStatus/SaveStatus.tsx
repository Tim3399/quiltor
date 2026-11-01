import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import type { HTMLAttributes } from "react";
import { Button } from "../../primitives/Button";
import "./SaveStatus.css";

export type SaveStatusPhase = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  phase: SaveStatusPhase;
  label: string;
  labelVisibility?: "always" | "attention";
  error?: string;
  /** Server request id of the failure. Shown only in the error phase, selectable as a whole. */
  errorId?: string;
  /** Localized line that contains `errorId`, e.g. "Fehler-ID: {id}". Defaults to the bare id. */
  errorIdLabel?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function SaveStatus({
  phase,
  label,
  labelVisibility = "always",
  error,
  errorId,
  errorIdLabel,
  retryLabel,
  onRetry,
  className = "",
  ...props
}: SaveStatusProps) {
  const Icon =
    phase === "error"
      ? AlertCircle
      : phase === "saving"
        ? LoaderCircle
        : phase === "dirty"
          ? AlertCircle
          : Check;
  const idLine = phase === "error" && errorId ? (errorIdLabel ?? errorId) : "";
  const idAt = idLine ? idLine.indexOf(errorId ?? "") : -1;
  return (
    <div
      {...props}
      className={`save-status-component save-status-component--${phase} ${className}`.trim()}
      data-phase={phase}
      data-label-visibility={labelVisibility}
      data-error-id={idLine ? "" : undefined}
      role={phase === "error" ? "alert" : "status"}
      aria-live={phase === "error" ? "assertive" : "polite"}
      aria-busy={phase === "saving" || undefined}
    >
      <span className="save-status-component__state">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </span>
      {(error || idLine) && (
        <span className="save-status-component__detail">
          {error}
          {error && idLine && <br />}
          {idLine}
        </span>
      )}
      {idLine && (
        <span className="save-status-component__error-id" title={idLine} aria-hidden="true">
          {idAt < 0 ? (
            <span className="save-status-component__error-id-value">{idLine}</span>
          ) : (
            <>
              {idLine.slice(0, idAt)}
              <span className="save-status-component__error-id-value">{errorId}</span>
              {idLine.slice(idAt + (errorId ?? "").length)}
            </>
          )}
        </span>
      )}
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
