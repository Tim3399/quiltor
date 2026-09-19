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
  const [failure, setFailure] = useState<unknown>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  const pending = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const initialized = useRef(false);
  const acceptedReplacement = useRef<T | null>(null);
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
          setFailure(null);
          await save(snapshot);
          if (latest.current === snapshot) dirty.current = false;
        }
        setSavedAt(Date.now());
        setPhase("saved");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("saveFailed"));
        setFailure(reason);
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
    if (acceptedReplacement.current === value) {
      acceptedReplacement.current = null;
      initialized.current = true;
      return;
    }
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
  const resolve = useCallback(
    (snapshot: T, saveExpected: (snapshot: T) => Promise<unknown>): Promise<void> => {
      clearTimeout(timer.current);
      if (pending.current) return pending.current;
      if (latest.current !== snapshot) return Promise.reject(new Error(t("recoveryDraftChanged")));
      pending.current = Promise.resolve().then(async () => {
        try {
          setPhase("saving");
          setError("");
          setFailure(null);
          await saveExpected(snapshot);
          if (latest.current === snapshot) dirty.current = false;
          while (latest.current && dirty.current) {
            const next = latest.current;
            await save(next);
            if (latest.current === next) dirty.current = false;
          }
          setSavedAt(Date.now());
          setPhase("saved");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : t("saveFailed"));
          setFailure(reason);
          setPhase("error");
          throw reason;
        } finally {
          pending.current = null;
        }
      });
      return pending.current;
    },
    [save, t],
  );
  const replace = useCallback((expected: T, persisted: T): boolean => {
    if (pending.current || latest.current !== expected) return false;
    clearTimeout(timer.current);
    latest.current = persisted;
    acceptedReplacement.current = persisted;
    dirty.current = false;
    setError("");
    setFailure(null);
    setSavedAt(Date.now());
    setPhase("saved");
    return true;
  }, []);
  const isDirty = useCallback(() => dirty.current, []);
  return { phase, error, failure, savedAt, flush, retry, resolve, replace, isDirty };
}
