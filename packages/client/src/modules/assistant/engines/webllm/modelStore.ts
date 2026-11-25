import type { WebllmEngine, WebllmRuntime } from "./webllmTypes";

// The in-browser model's life in this tab (T-61 part 7): is it on disk, is it downloading, is
// it loaded. Shared by the executor, which needs a loaded engine, and the panel, which shows
// the download and the remove button.

export type ModelState =
  | { phase: "unknown" }
  | { phase: "absent" }
  | { phase: "cached" }
  | { phase: "downloading"; progress: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

type StorageLike = { persist?: () => Promise<boolean> };

export interface ModelStore {
  getState(): ModelState;
  subscribe(listener: () => void): () => void;
  /** Asks the cache whether the model is on disk; does nothing once a load has begun. */
  refresh(): Promise<void>;
  /** Downloads (or reads from the cache) and loads the model. */
  download(): Promise<void>;
  /** The loaded engine, loading a cached model first; null while the model is not on disk. */
  engine(): Promise<WebllmEngine | null>;
  /**
   * Drops an engine that can no longer generate (T-362), so the next `engine()` loads a fresh
   * one from the cache. Does nothing when the store has moved on to another engine already.
   */
  discard(engine: WebllmEngine): Promise<void>;
  /** Unloads the engine and deletes the model from the browser's storage. */
  remove(): Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createModelStore(
  runtime: WebllmRuntime,
  storage: StorageLike | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.storage,
): ModelStore {
  let state: ModelState = { phase: "unknown" };
  let loading: Promise<WebllmEngine> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ModelState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const load = () => {
    loading ??= (async () => {
      // Ask once to keep the download of a few gigabytes; a refusal changes nothing.
      try {
        await storage?.persist?.();
      } catch {
        // Persistence is a wish, not a condition.
      }
      set({ phase: "downloading", progress: 0 });
      try {
        const engine = await runtime.load(({ progress }) =>
          set({ phase: "downloading", progress }),
        );
        set({ phase: "ready" });
        return engine;
      } catch (error) {
        loading = null;
        set({ phase: "error", message: message(error) });
        throw error;
      }
    })();
    return loading;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      if (loading) return;
      try {
        const cached = await runtime.isCached();
        if (!loading) set({ phase: cached ? "cached" : "absent" });
      } catch (error) {
        if (!loading) set({ phase: "error", message: message(error) });
      }
    },
    async download() {
      await load();
    },
    async engine() {
      if (loading) return loading;
      if (!(await runtime.isCached())) return null;
      return load();
    },
    async discard(engine) {
      const pending = loading;
      if (!pending) return;
      let current: WebllmEngine | null = null;
      try {
        current = await pending;
      } catch {
        return;
      }
      if (current !== engine || loading !== pending) return;
      loading = null;
      set({ phase: "cached" });
      try {
        await engine.unload();
      } catch {
        // An engine that lost its pipeline may fail to unload; it is dropped either way.
      }
    },
    async remove() {
      const pending = loading;
      loading = null;
      if (pending) {
        try {
          await (await pending).unload();
        } catch {
          // A load that failed has nothing to unload.
        }
      }
      try {
        await runtime.remove();
        set({ phase: "absent" });
      } catch (error) {
        set({ phase: "error", message: message(error) });
      }
    },
  };
}
