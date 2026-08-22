import type {
  AssistantHistoryMessage,
  AssistantJobState,
  AssistantReply,
} from "../../modules/assistant";
import {
  ApplicationGatewayError,
  type AssistantBatchRequest,
  type AssistantGateway,
} from "../application";
import { decodeAssistantJobV1, type AssistantJobWireV1 } from "../contracts/v1/assistant";
import { currentUiLocale } from "./locale";
import {
  applicationCodeForHttpStatus,
  requestJson,
  withWorldBody,
  withWorldQuery,
  type HttpApplicationState,
} from "./request";

const JOBS_PATH = "/api/assistant/jobs";
const JOB_PATH = "/api/assistant/job";
const CANCEL_PATH = "/api/assistant/job/cancel";
const POLL_MS = 1000;

type AssistantJobMethods = Pick<AssistantGateway, "jobStatus" | "cancelJob" | "wait" | "chat">;

type AssistantJobCreateResult = {
  ok: boolean;
  created: boolean;
  job: AssistantJobState;
};

type AssistantJobCreateWireV1 = Omit<AssistantJobCreateResult, "job"> & {
  job: AssistantJobWireV1;
};

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function createJob(
  state: HttpApplicationState,
  question: string,
  history: AssistantHistoryMessage[],
  signal: AbortSignal | undefined,
  chapterIds: string[] | undefined,
  batch: AssistantBatchRequest | undefined,
  idempotencyKey: string,
): Promise<AssistantJobCreateResult> {
  const request = async () => {
    const wire = await requestJson<AssistantJobCreateWireV1>(JOBS_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(
        withWorldBody(state, {
          question,
          history,
          chapterIds,
          runBatches: batch?.runBatches,
          progressId: batch?.progressId,
          language: currentUiLocale(),
        }),
      ),
      signal,
    });
    return {
      ...wire,
      job: decodeAssistantJobV1(wire.job, applicationCodeForHttpStatus(wire.job.httpStatus)),
    };
  };

  try {
    return await request();
  } catch (error) {
    // The server may have committed before the connection dropped. The same key safely resumes.
    if (signal?.aborted || error instanceof ApplicationGatewayError) throw error;
    return request();
  }
}

async function getJob(
  state: HttpApplicationState,
  id: string,
  signal?: AbortSignal,
): Promise<AssistantJobState> {
  const response = await requestJson<{ ok: boolean; job: AssistantJobWireV1 }>(
    withWorldQuery(state, `${JOB_PATH}?id=${encodeURIComponent(id)}`),
    { signal },
  );
  return decodeAssistantJobV1(response.job, applicationCodeForHttpStatus(response.job.httpStatus));
}

async function cancelJob(state: HttpApplicationState, id: string): Promise<AssistantJobState> {
  const response = await requestJson<{ ok: boolean; job: AssistantJobWireV1 }>(CANCEL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withWorldBody(state, { id })),
  });
  return decodeAssistantJobV1(response.job, applicationCodeForHttpStatus(response.job.httpStatus));
}

function terminalReply(job: AssistantJobState): AssistantReply {
  if (job.status === "completed" && job.result) return job.result;
  if (job.status === "cancelled") throw abortError();
  if (job.status === "failed") {
    throw new ApplicationGatewayError(
      job.error || "Assistant-Anfrage fehlgeschlagen.",
      job.failureCode || "unavailable",
    );
  }
  throw new Error(`Assistant job ${job.id} is not terminal.`);
}

async function waitForJob(
  state: HttpApplicationState,
  id: string,
  signal?: AbortSignal,
): Promise<AssistantReply> {
  while (true) {
    throwIfAborted(signal);
    let job: AssistantJobState;
    try {
      job = await getJob(state, id, signal);
    } catch (error) {
      // A confirmed durable job must survive temporary server/transport outages. Only
      // authoritative client errors are terminal; retrying keeps the same job and
      // idempotency key instead of allowing the UI to create a duplicate job.
      if (
        signal?.aborted ||
        (error instanceof ApplicationGatewayError && error.category !== "unavailable")
      ) {
        throw error;
      }
      await delay(POLL_MS, signal);
      continue;
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return terminalReply(job);
    }
    await delay(POLL_MS, signal);
  }
}

export function createAssistantJobsHttpGateway(state: HttpApplicationState): AssistantJobMethods {
  return {
    jobStatus: (id, signal) => getJob(state, id, signal),
    cancelJob: (id) => cancelJob(state, id),
    wait: (id, signal) => waitForJob(state, id, signal),
    chat: async (
      question,
      history = [],
      signal,
      chapterIds,
      batch,
      idempotencyKey = crypto.randomUUID(),
      onJobCreated,
    ) => {
      const created = await createJob(
        state,
        question,
        history,
        signal,
        chapterIds,
        batch,
        idempotencyKey,
      );
      onJobCreated?.(created.job);
      if (
        created.job.status === "completed" ||
        created.job.status === "failed" ||
        created.job.status === "cancelled"
      ) {
        return terminalReply(created.job);
      }
      return waitForJob(state, created.job.id, signal);
    },
  };
}
