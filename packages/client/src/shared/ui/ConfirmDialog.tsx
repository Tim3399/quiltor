import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "./Dialog";
import { undoShortcut } from "./shortcuts";
import { useI18n } from "../../i18n";

// Hold-to-confirm is reserved for the two actions that nothing can take back: deleting a world
// (the persistence adapter removes database, backups and history in one go) and restoring a
// backup (it replaces the database and reloads, which drops the undo stack). Everything else routes
// through useHistoryState and is one undo away, so it gets a plain confirmation instead -- the
// pattern Apple and Material both use for destructive actions. A five-second hold on a reversible
// delete only costs time; it buys no safety that the undo stack does not already provide.
export const IRREVERSIBLE_HOLD_MS = 1500;

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  holdDurationMs = 0,
  undoable = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  holdDurationMs?: number;
  undoable?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const descriptionId = useId();
  const complete = () => {
    onConfirm();
    onClose();
  };
  return (
    <Dialog title={title} onClose={onClose} role="alertdialog" describedById={descriptionId}>
      <div className="confirm-message">
        <AlertTriangle aria-hidden="true" />
        <p id={descriptionId}>
          {description}
          {undoable && (
            <>
              <br />
              <span className="muted">{t("undoHint", { shortcut: undoShortcut(locale) })}</span>
            </>
          )}
        </p>
      </div>
      {/* Cancel carries the autofocus so the safe option is preselected; useOverlayFocus picks it up. */}
      <div className="dialog-actions">
        <button data-autofocus onClick={onClose}>
          {t("cancel")}
        </button>
        {holdDurationMs > 0 ? (
          <HoldButton label={confirmLabel} duration={holdDurationMs} onComplete={complete} />
        ) : (
          <button className="danger-button" onClick={complete}>
            {confirmLabel}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function HoldButton({
  label,
  duration,
  onComplete,
}: {
  label: string;
  duration: number;
  onComplete: () => void;
}) {
  const { t } = useI18n();
  const [startedAt, setStartedAt] = useState<number | null>(null),
    [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null),
    completed = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    completed.current = false;
    setStartedAt(null);
    setProgress(0);
  };
  const start = () => {
    if (startedAt !== null) return;
    const startTime = performance.now();
    completed.current = false;
    setStartedAt(startTime);
    setProgress(0);
    timer.current = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - startTime) / duration);
      setProgress(next);
      if (next >= 1 && !completed.current) {
        completed.current = true;
        if (timer.current !== null) window.clearInterval(timer.current);
        onComplete();
      }
    }, 40);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );
  return (
    <button
      className={`danger-button hold-button ${startedAt !== null ? "is-holding" : ""}`}
      style={{ "--hold-progress": progress } as React.CSSProperties}
      aria-label={t("holdAriaLabel", { label })}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") cancel();
      }}
      onBlur={cancel}
    >
      <span>{startedAt === null ? t("holdToConfirm", { label }) : t("keepHolding")}</span>
    </button>
  );
}
