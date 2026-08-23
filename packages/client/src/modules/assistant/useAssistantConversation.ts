import { useCallback, useEffect, useRef, useState } from "react";
import type { Translate } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import type { AssistantClaimStatus, AssistantProposal, AssistantReply } from "./model";
import { scopeAssistantProposals } from "./proposals";
import { replyReferences, resolveAssistantMessage } from "./formatting";
import type { AssistantEntry, AssistantSendOptions } from "./conversationTypes";
import { useBatchProgress } from "./useBatchProgress";

function readEntries(storageKey: string): AssistantEntry[] {
  try {
    const stored = quiltorClient.platform.preferences.get(storageKey);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useAssistantConversation({
  worldId,
  forcedChapterIds,
  onApply,
  t,
}: {
  worldId: string;
  forcedChapterIds: string[];
  onApply: (proposals: AssistantProposal[]) => void;
  t: Translate;
}) {
  const storageKey = `quiltor-assistant:${worldId}`;
  const [entries, setEntries] = useState<AssistantEntry[]>(() => readEntries(storageKey));
  const entriesRef = useRef(entries);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeJobRef = useRef<string | null>(null);
  // React state is not a mutex. Flip this synchronously so duplicate submit events
  // in the same render turn cannot both reach the API.
  const sendLockRef = useRef(false);
  const { batchProgress, watchBatchProgress, finishBatchProgress } = useBatchProgress();

  const persistEntries = useCallback(
    (update: (current: AssistantEntry[]) => AssistantEntry[]) => {
      const next = update(entriesRef.current);
      entriesRef.current = next;
      quiltorClient.platform.preferences.set(storageKey, JSON.stringify(next.slice(-40)));
      setEntries(next);
    },
    [storageKey],
  );

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const storeReply = useCallback(
    (entryId: string, response: AssistantReply) => {
      const proposals = scopeAssistantProposals(response.proposals || [], entryId);
      const reply = {
        ...response,
        proposals,
        proposalEnvelopes: response.proposalEnvelopes?.map((envelope, index) => ({
          ...envelope,
          proposal: proposals[index] ?? envelope.proposal,
        })),
      };
      persistEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                reply,
                error: undefined,
                requestId: undefined,
                jobId: undefined,
                history: undefined,
                chapterIds: undefined,
                runBatches: undefined,
                progressId: undefined,
                claimStatuses: Object.fromEntries(
                  (reply.proposalEnvelopes || []).map((envelope, index) => [
                    index,
                    envelope.claimStatus || "unresolved",
                  ]),
                ),
              }
            : entry,
        ),
      );
    },
    [persistEntries],
  );

  // Server jobs outlive the page. A persisted job id resumes polling without
  // ever sending the prompt a second time.
  useEffect(() => {
    if (sending || sendLockRef.current) return;
    const pending = [...entries]
      .reverse()
      .find((entry) => entry.jobId && !entry.reply && !entry.error);
    if (!pending?.jobId) return;

    sendLockRef.current = true;
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    activeJobRef.current = pending.jobId;
    const progressInterval = pending.progressId
      ? watchBatchProgress(pending.progressId)
      : undefined;

    void quiltorClient.application.assistant
      .wait(pending.jobId, controller.signal)
      .then((response) => storeReply(pending.id, response))
      .catch((error) => {
        const message = controller.signal.aborted
          ? t("requestAborted")
          : applicationErrorMessage(error);
        persistEntries((current) =>
          current.map((entry) =>
            entry.id === pending.id
              ? {
                  ...entry,
                  error: message,
                  requestId: undefined,
                  jobId: undefined,
                  progressId: undefined,
                }
              : entry,
          ),
        );
      })
      .finally(() => {
        sendLockRef.current = false;
        setSending(false);
        if (abortRef.current === controller) abortRef.current = null;
        if (activeJobRef.current === pending.jobId) activeJobRef.current = null;
        finishBatchProgress(progressInterval);
      });
  }, [entries, finishBatchProgress, persistEntries, sending, storeReply, t, watchBatchProgress]);

  const send = useCallback(
    async (retryId?: string, options?: AssistantSendOptions, explicitQuestion?: string) => {
      if (sendLockRef.current) return;
      const question =
        explicitQuestion ||
        (retryId ? entries.find((entry) => entry.id === retryId)?.question : undefined);
      if (!question || sending) return;

      sendLockRef.current = true;
      const id = retryId ?? crypto.randomUUID();
      const previous = retryId ? entries.find((entry) => entry.id === retryId) : undefined;
      const idempotencyKey = previous?.requestId ?? crypto.randomUUID();
      const history =
        previous?.history ??
        entries
          .filter((entry) => entry.id !== id)
          .flatMap((entry) => [
            { role: "user" as const, content: entry.question },
            ...(entry.reply
              ? [
                  {
                    role: "assistant" as const,
                    content: resolveAssistantMessage(entry.reply, t),
                    references: replyReferences(entry.reply),
                  },
                ]
              : []),
          ]);
      const chapterIds =
        previous?.chapterIds ??
        options?.chapterIds ??
        (forcedChapterIds.length ? [...forcedChapterIds] : undefined);
      const mode = previous?.mode ?? options?.mode ?? "chat";
      const runBatches =
        previous?.runBatches ?? (mode === "world_extraction" || Boolean(options?.batch));
      const progressId = runBatches ? (previous?.progressId ?? crypto.randomUUID()) : undefined;
      const batch = runBatches && progressId ? { runBatches: true, progressId, mode } : undefined;

      if (retryId) {
        persistEntries((current) =>
          current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  error: undefined,
                  requestId: idempotencyKey,
                  jobId: undefined,
                  history,
                  chapterIds,
                  runBatches,
                  progressId,
                  mode,
                }
              : entry,
          ),
        );
      } else {
        // Persist the idempotency key before the request can reach the server.
        persistEntries((current) => [
          ...current,
          {
            id,
            question,
            applied: [],
            requestId: idempotencyKey,
            history,
            chapterIds,
            runBatches,
            progressId,
            mode,
            dismissed: [],
            proposalEdits: {},
          },
        ]);
      }

      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let progressInterval: number | undefined;
      try {
        const response = await quiltorClient.application.assistant.chat(
          question,
          history,
          controller.signal,
          chapterIds,
          batch,
          idempotencyKey,
          (job) => {
            activeJobRef.current = job.id;
            const currentProgressId = job.progressId || batch?.progressId || undefined;
            persistEntries((current) =>
              current.map((entry) =>
                entry.id === id
                  ? { ...entry, jobId: job.id, progressId: currentProgressId }
                  : entry,
              ),
            );
            if (currentProgressId && !progressInterval)
              progressInterval = watchBatchProgress(currentProgressId);
          },
        );
        storeReply(id, response);
      } catch (error) {
        const message = controller.signal.aborted
          ? t("requestAborted")
          : applicationErrorMessage(error);
        const keepRequestId = !controller.signal.aborted && !activeJobRef.current;
        persistEntries((current) =>
          current.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  error: message,
                  requestId: keepRequestId ? entry.requestId : undefined,
                  jobId: undefined,
                  progressId: undefined,
                }
              : entry,
          ),
        );
      } finally {
        sendLockRef.current = false;
        setSending(false);
        if (abortRef.current === controller) abortRef.current = null;
        activeJobRef.current = null;
        finishBatchProgress(progressInterval);
      }
    },
    [
      entries,
      finishBatchProgress,
      forcedChapterIds,
      persistEntries,
      sending,
      storeReply,
      t,
      watchBatchProgress,
    ],
  );

  const cancel = useCallback(() => {
    const jobId = activeJobRef.current;
    abortRef.current?.abort();
    if (jobId) void quiltorClient.application.assistant.cancelJob(jobId).catch(() => {});
  }, []);

  const apply = useCallback(
    (entryId: string, proposals: AssistantProposal[], indices: number[]) => {
      const entry = entriesRef.current.find((item) => item.id === entryId);
      const accepted = proposals
        .map((proposal, offset) => ({ proposal, index: indices[offset] }))
        .filter(
          ({ index }) =>
            index !== undefined &&
            (entry?.mode !== "world_extraction" ||
              entry.claimStatuses?.[index] === "objective_fact"),
        );
      if (!accepted.length) return;
      onApply(accepted.map(({ proposal }) => proposal));
      const acceptedIndices = accepted.map(({ index }) => index);
      persistEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? { ...entry, applied: [...new Set([...entry.applied, ...acceptedIndices])] }
            : entry,
        ),
      );
    },
    [onApply, persistEntries],
  );

  const dismiss = useCallback(
    (entryId: string, index: number) =>
      persistEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? { ...entry, dismissed: [...new Set([...(entry.dismissed || []), index])] }
            : entry,
        ),
      ),
    [persistEntries],
  );

  const edit = useCallback(
    (entryId: string, index: number, proposal: AssistantProposal) =>
      persistEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                proposalEdits: { ...(entry.proposalEdits || {}), [index]: proposal },
                dismissed: (entry.dismissed || []).filter((item) => item !== index),
              }
            : entry,
        ),
      ),
    [persistEntries],
  );

  const classifyClaim = useCallback(
    (entryId: string, index: number, claimStatus: AssistantClaimStatus) =>
      persistEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                claimStatuses: { ...(entry.claimStatuses || {}), [index]: claimStatus },
              }
            : entry,
        ),
      ),
    [persistEntries],
  );

  const clear = useCallback(() => persistEntries(() => []), [persistEntries]);

  return {
    entries,
    sending,
    batchProgress,
    send,
    cancel,
    apply,
    dismiss,
    edit,
    classifyClaim,
    clear,
  };
}
