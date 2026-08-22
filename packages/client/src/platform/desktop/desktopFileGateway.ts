import type { FileGateway, SaveFileResult } from "../PlatformGateway";
import {
  fileSaveRequest,
  nextNativeRequestId,
  parseFileSaveResponse,
  type NativeBridgeV1,
} from "./nativeBridgeV1";

declare global {
  interface Window {
    pywebview?: { api?: Partial<NativeBridgeV1> };
  }
}

function bridge(): NativeBridgeV1 | null {
  const candidate = globalThis.window.pywebview?.api;
  return candidate && typeof candidate.invoke === "function" ? (candidate as NativeBridgeV1) : null;
}

/** Bytes become base64 because pywebview's JSON bridge is not binary-safe. */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read export data."));
    reader.readAsDataURL(blob);
  });
}

export function desktopFileGateway(
  createRequestId: () => string = nextNativeRequestId,
): FileGateway | null {
  const nativeBridge = bridge();
  if (!nativeBridge) return null;
  return {
    async save(name, content): Promise<SaveFileResult> {
      try {
        const requestId = createRequestId();
        const request = fileSaveRequest(requestId, name, await base64(content));
        const response = parseFileSaveResponse(await nativeBridge.invoke(request), requestId);
        if (!response) return { status: "failed", code: "native_bridge.invalid_response" };
        if (!response.ok) return { status: "failed", code: response.error.code };
        return { status: response.result.status };
      } catch {
        return {
          status: "failed",
          code: "native_bridge.invoke_failed",
        };
      }
    },
  };
}
