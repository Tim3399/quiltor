import { AlertCircle, Check, CloudOff, LoaderCircle } from "lucide-react";
import type { SavePhase } from "../../types";
import { useLanguage, type MessageKey } from "../../language";

const labelKeys: Record<SavePhase, MessageKey> = {
  idle: "ready",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "notSaved",
};

export function SaveStatus({
  phase,
  error,
  onRetry,
}: {
  phase: SavePhase;
  error?: string;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  const Icon =
    phase === "error"
      ? CloudOff
      : phase === "saving"
        ? LoaderCircle
        : phase === "saved"
          ? Check
          : phase === "dirty"
            ? AlertCircle
            : Check;
  const content = (
    <>
      <Icon size={15} className={phase === "saving" ? "spin" : ""} aria-hidden="true" />
      <span>{t(labelKeys[phase])}</span>
    </>
  );
  return phase === "error" ? (
    <button
      className={`save-status save-${phase}`}
      onClick={onRetry}
      title={error || t(labelKeys[phase])}
      aria-live="polite"
    >
      {content}
    </button>
  ) : (
    <div className={`save-status save-${phase}`} title={t(labelKeys[phase])} aria-live="polite">
      {content}
    </div>
  );
}
