import {
  ApplicationGatewayError,
  type IdentityGateway,
  type IdentityLogoutResult,
} from "../application";
import { requestJson } from "./request";

function decodeLogoutResponse(value: unknown): IdentityLogoutResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationGatewayError("Ungültige Abmeldeantwort.", "invalid_response");
  }
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true ||
    (record.logoutUrl !== undefined && typeof record.logoutUrl !== "string")
  ) {
    throw new ApplicationGatewayError("Ungültige Abmeldeantwort.", "invalid_response");
  }
  if (!record.logoutUrl) return {};
  try {
    const protocol = new URL(record.logoutUrl).protocol;
    if (protocol !== "https:" && protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new ApplicationGatewayError("Ungültige Abmeldeantwort.", "invalid_response");
  }
  return { logoutUrl: record.logoutUrl };
}

export function createIdentityHttpGateway(): IdentityGateway {
  return {
    current: () =>
      requestJson<{
        ok: boolean;
        sub?: string;
        email?: string;
        name?: string;
        multiUser?: boolean;
      }>("/api/whoami"),
    logout: async () =>
      decodeLogoutResponse(await requestJson<unknown>("/logout", { method: "POST" })),
  };
}
