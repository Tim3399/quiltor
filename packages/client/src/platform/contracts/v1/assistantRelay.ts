// GET /api/assistant/relay/next and POST /api/assistant/relay/answer (T-61 part 3).
// The decoder never throws: an answer that is not a ticket is treated as no ticket.

/** The server's hard limit on an answer body (MAX_ANSWER_BYTES, 256 KiB). */
const RELAY_MAX_ANSWER_BYTES = 262_144;

export type RelayRequestV1 = {
  ticket: string;
  seq: number;
  engine: string;
  payload: Record<string, unknown>;
  limits: { maxOutputBytes: number; answerBySeconds: number };
};

export type RelayAnswerV1 = {
  ticket: string;
  seq: number;
} & (
  | {
      output: {
        content: string;
        finishReason: "stop" | "length";
        usage?: { promptTokens?: number; completionTokens?: number };
      };
    }
  | { error: { code: string; status?: number; detail?: string } }
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function decodeRelayRequestV1(value: unknown): RelayRequestV1 | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.request)) return null;
  const request = value.request;
  if (
    typeof request.ticket !== "string" ||
    typeof request.seq !== "number" ||
    !Number.isInteger(request.seq) ||
    typeof request.engine !== "string" ||
    !isRecord(request.payload)
  ) {
    return null;
  }
  const limits = isRecord(request.limits) ? request.limits : {};
  return {
    ticket: request.ticket,
    seq: request.seq,
    engine: request.engine,
    payload: request.payload,
    limits: {
      // Never more than the server takes, whatever a ticket claims.
      maxOutputBytes: Math.min(
        positive(limits.maxOutputBytes, RELAY_MAX_ANSWER_BYTES),
        RELAY_MAX_ANSWER_BYTES,
      ),
      answerBySeconds: positive(limits.answerBySeconds, 60),
    },
  };
}
