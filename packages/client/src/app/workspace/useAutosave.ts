import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { ApplicationGatewayError } from "../../platform/application/errors";
import type { SavePhase } from "../../shared";
import { useLatest } from "../../shared/hooks/useLatest";

// The request id is what an operator searches the server log for; code says what failed.
function reportSaveFailure(reason: unknown): void {
  const gateway = reason instanceof ApplicationGatewayError ? reason : null;
  console.warn("save failed", {
    code: gateway?.code ?? "unknown",
    requestId: gateway?.requestId,
  });
}

/** The server request id of a failed save, when the failure carries one. */
function saveFailureRequestId(failure: unknown): string | undefined {
  return failure instanceof ApplicationGatewayError ? failure.requestId : undefined;
}

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
  // Not useLatest, deliberately (T-17 F-17-2): `latest` has two writers. The render gives it
  // the current value; replace() gives it the server-confirmed `persisted`, and flush(),
  // resolve() and the timer compare against that before the next render. An assignment in an
  // insertion effect would overwrite the handler's value with the prop at the next commit
  // whenever the caller does not re-render with `persisted` at once -- a new window in the
  // save path for a purely formal gain. Covered by "resolves the persisted value right after a
  // replace…" and the test after it.
  // eslint-disable-next-line react-hooks/refs -- two writers (render and replace) by design, F-17-2; see above
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
        reportSaveFailure(reason);
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
  // Read only, by the debounce timer, which must run the flush of the latest render.
  const flushRef = useLatest(flush);

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
          reportSaveFailure(reason);
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
  // The next value is loaded, not edited: it must not count as a change to save.
  const accept = useCallback((loaded: T) => {
    acceptedReplacement.current = loaded;
  }, []);
  // Drop all save state when the documents leave. Refuses while a save is still out.
  // `onScreen` keeps the current value as the baseline: the documents stay visible, so the
  // next change is an edit that must reach `save` (and beforeunload), not a fresh load.
  const discard = useCallback(({ onScreen = false }: { onScreen?: boolean } = {}): boolean => {
    if (pending.current) return false;
    clearTimeout(timer.current);
    dirty.current = false;
    acceptedReplacement.current = null;
    if (!onScreen) initialized.current = false;
    setPhase("idle");
    setError("");
    setFailure(null);
    return true;
  }, []);
  const isDirty = useCallback(() => dirty.current, []);
  const errorId = saveFailureRequestId(failure);
  return {
    phase,
    error,
    errorId,
    failure,
    savedAt,
    flush,
    retry,
    resolve,
    replace,
    accept,
    discard,
    isDirty,
  };
}
