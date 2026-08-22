export const NATIVE_BRIDGE_VERSION = 1 as const;
export const FILE_SAVE_OPERATION = "file.save" as const;

export interface NativeBridgeError {
  code: string;
  params?: { supported: 1 } | { operation: string };
  retryable: boolean;
}

export interface FileSavePayload {
  name: string;
  content: string;
  encoding: "base64";
}

export type FileSaveNativeResult = { status: "saved" } | { status: "cancelled" };

export interface FileSaveRequest {
  version: typeof NATIVE_BRIDGE_VERSION;
  id: string;
  operation: typeof FILE_SAVE_OPERATION;
  payload: FileSavePayload;
}

export type FileSaveResponse =
  | {
      version: typeof NATIVE_BRIDGE_VERSION;
      id: string;
      ok: true;
      result: FileSaveNativeResult;
    }
  | {
      version: typeof NATIVE_BRIDGE_VERSION;
      id: string;
      ok: false;
      error: NativeBridgeError;
    };

export interface NativeBridgeV1 {
  invoke(request: FileSaveRequest): Promise<unknown>;
}

let requestSequence = 0;

export function nextNativeRequestId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  requestSequence += 1;
  return `file-save-${Date.now()}-${requestSequence}`;
}

export function fileSaveRequest(id: string, name: string, content: string): FileSaveRequest {
  return {
    version: NATIVE_BRIDGE_VERSION,
    id,
    operation: FILE_SAVE_OPERATION,
    payload: { name, content, encoding: "base64" },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isNativeBridgeError(value: unknown): value is NativeBridgeError {
  return (
    isObject(value) &&
    Object.keys(value).every((key) => ["code", "params", "retryable"].includes(key)) &&
    typeof value.code === "string" &&
    value.code.length >= 3 &&
    value.code.length <= 128 &&
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value.code) &&
    (value.params === undefined ||
      (isObject(value.params) &&
        ((hasOnlyKeys(value.params, ["supported"]) && value.params.supported === 1) ||
          (hasOnlyKeys(value.params, ["operation"]) &&
            typeof value.params.operation === "string" &&
            value.params.operation.length >= 1 &&
            value.params.operation.length <= 128)))) &&
    typeof value.retryable === "boolean"
  );
}

export function parseFileSaveResponse(value: unknown, requestId: string): FileSaveResponse | null {
  if (
    !isObject(value) ||
    value.version !== NATIVE_BRIDGE_VERSION ||
    value.id !== requestId ||
    typeof value.ok !== "boolean"
  ) {
    return null;
  }
  if (value.ok) {
    const result = value.result;
    if (
      !hasOnlyKeys(value, ["version", "id", "ok", "result"]) ||
      !isObject(result) ||
      !hasOnlyKeys(result, ["status"]) ||
      (result.status !== "saved" && result.status !== "cancelled")
    ) {
      return null;
    }
    return {
      version: NATIVE_BRIDGE_VERSION,
      id: requestId,
      ok: true,
      result: { status: result.status },
    };
  }
  if (!hasOnlyKeys(value, ["version", "id", "ok", "error"]) || !isNativeBridgeError(value.error)) {
    return null;
  }
  return {
    version: NATIVE_BRIDGE_VERSION,
    id: requestId,
    ok: false,
    error: value.error,
  };
}
