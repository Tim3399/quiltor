import type { ApplicationErrorCategory } from "../../shared";
import { ApplicationGatewayError } from "../application";
import { currentMessages } from "./locale";

export type HttpApplicationState = {
  activeWorldId: string;
  revisions: { manuscript: number; figures: number; storyboards: number };
};

export function createHttpApplicationState(): HttpApplicationState {
  return { activeWorldId: "", revisions: { manuscript: 0, figures: 0, storyboards: 0 } };
}

export function withWorldQuery(state: HttpApplicationState, url: string): string {
  if (!state.activeWorldId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}world=${encodeURIComponent(state.activeWorldId)}`;
}

export function withWorldBody<T extends object>(
  state: HttpApplicationState,
  data: T,
): T & { worldId?: string } {
  return state.activeWorldId ? { ...data, worldId: state.activeWorldId } : data;
}

export function applicationCodeForHttpStatus(
  status: number | null | undefined,
): ApplicationErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid_request";
  if (status != null && status >= 500) return "unavailable";
  return "unknown";
}

type StructuredApplicationError = {
  code: string;
  params: Readonly<Record<string, unknown>>;
  retryable: boolean;
};

function localizedApplicationErrorMessage(category: ApplicationErrorCategory): string {
  const messages = currentMessages();
  const messageByCategory = {
    unauthorized: messages.errorUnauthorized,
    forbidden: messages.errorForbidden,
    not_found: messages.errorNotFound,
    conflict: messages.errorConflict,
    invalid_request: messages.errorInvalidRequest,
    invalid_response: messages.errorInvalidResponse,
    unavailable: messages.errorUnavailable,
    unknown: messages.errorUnknown,
  } satisfies Record<ApplicationErrorCategory, string>;
  return messageByCategory[category];
}

function structuredApplicationError(value: unknown): StructuredApplicationError | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const candidate = envelope.error;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(record.code)
  ) {
    return null;
  }
  const params = record.params;
  if (
    params !== undefined &&
    (params === null || typeof params !== "object" || Array.isArray(params))
  ) {
    return null;
  }
  if (record.retryable !== undefined && typeof record.retryable !== "boolean") return null;
  return {
    code: record.code,
    params: (params as Readonly<Record<string, unknown>> | undefined) ?? {},
    retryable: record.retryable === true,
  };
}

export function httpResponseError(response: Response, data: unknown): ApplicationGatewayError {
  const category = applicationCodeForHttpStatus(response.status);
  const structured = structuredApplicationError(data);
  return new ApplicationGatewayError(
    localizedApplicationErrorMessage(category),
    structured?.code ?? category,
    {
      category,
      params: structured?.params,
      retryable: structured?.retryable ?? response.status >= 500,
    },
  );
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Small shared HTTP boundary. Port-specific decoders remain with their owning adapter. */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await readJson(response);
  if (!response.ok) throw httpResponseError(response, data);
  return data as T;
}
