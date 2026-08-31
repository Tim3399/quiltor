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
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  const initialized = useRef(false);
  const inFlightSnapshot = useRef<T | null>(null);
  latest.current = value;

  const flush = useCallback(async () => {
    if (!latest.current || !dirty.current) return;
    if (inFlightSnapshot.current === latest.current) return chain.current;
    clearTimeout(timer.current);
    const snapshot = latest.current;
    inFlightSnapshot.current = snapshot;
    setPhase("saving");
    setError("");
    chain.current = chain.current.catch(() => undefined).then(() => save(snapshot));
    try {
      await chain.current;
      if (latest.current === snapshot) {
        dirty.current = false;
        setPhase("saved");
      } else setPhase("dirty");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
      setPhase("error");
    } finally {
      if (inFlightSnapshot.current === snapshot) inFlightSnapshot.current = null;
    }
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
    timer.current = window.setTimeout(() => void flushRef.current(), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (phase === "dirty" || phase === "saving" || phase === "error") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  return { phase, error, flush, retry: flush };
}
