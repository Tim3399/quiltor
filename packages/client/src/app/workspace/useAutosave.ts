import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { SavePhase } from "../../shared";

const DEFAULT_AUTOSAVE_DELAY_MS = 800;

export function useAutosave<T>(
  value: T | null,
  save: (value: T) => Promise<unknown>,
  delay = DEFAULT_AUTOSAVE_DELAY_MS,
) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  const pending = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const initialized = useRef(false);
  latest.current = value;

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (!latest.current || !dirty.current) return Promise.resolve();
    // All explicit callers await the same drain, including edits made while a save is out.
    // Defer execution until the promise is registered, even if save throws synchronously.
    pending.current = Promise.resolve().then(async () => {
      try {
        while (latest.current && dirty.current) {
          const snapshot = latest.current;
          setPhase("saving");
          setError("");
          await save(snapshot);
          if (latest.current === snapshot) dirty.current = false;
        }
        setSavedAt(Date.now());
        setPhase("saved");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("saveFailed"));
        setPhase("error");
        throw reason;
      } finally {
        pending.current = null;
      }
    });
    return pending.current;
  }, [save, t]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!value) return;
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    dirty.current = true;
    setPhase("dirty");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current().catch(() => undefined), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (phase === "dirty" || phase === "saving" || phase === "error") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // UI retries report failure through SaveStatus; dependent operations use rejecting flush.
  const retry = useCallback(() => flush().catch(() => undefined), [flush]);
  const isDirty = useCallback(() => dirty.current, []);
  return { phase, error, savedAt, flush, retry, isDirty };
}
