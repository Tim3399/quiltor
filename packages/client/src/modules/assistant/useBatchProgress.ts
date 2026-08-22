import { useCallback, useState } from "react";
import { quiltorClient } from "../../platform";
import type { AssistantBatchProgress } from "./conversationTypes";

const BATCH_PROGRESS_POLL_MS = 1500;

export function useBatchProgress() {
  const [batchProgress, setBatchProgress] = useState<AssistantBatchProgress | null>(null);

  const watchBatchProgress = useCallback((progressId: string) => {
    setBatchProgress({ total: 0, done: 0 });
    const poll = () => {
      quiltorClient.application.assistant
        .progress(progressId)
        .then((response) => {
          if (response.progress) setBatchProgress(response.progress);
        })
        .catch(() => {});
    };
    void poll();
    return window.setInterval(poll, BATCH_PROGRESS_POLL_MS);
  }, []);

  const finishBatchProgress = useCallback((interval?: number) => {
    if (interval) window.clearInterval(interval);
    setBatchProgress(null);
  }, []);

  return { batchProgress, watchBatchProgress, finishBatchProgress };
}
