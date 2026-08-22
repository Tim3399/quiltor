import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./request";

const revisionConflictFixture = JSON.parse(
  readFileSync(
    "contracts/fixtures/application-api/structured-error/revision-conflict.v1.json",
    "utf8",
  ),
) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe("HTTP application errors", () => {
  it("maps HTTP authorization to a transport-neutral stable code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "auth.unauthenticated", retryable: false },
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const request = requestJson("/api/worlds");

    await expect(request).rejects.toMatchObject({
      code: "auth.unauthenticated",
      category: "unauthorized",
      message: "Bitte melde dich an, um fortzufahren.",
    });
    await expect(request).rejects.not.toHaveProperty("httpStatus");
  });

  it("preserves a structured application error instead of guessing it from HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: revisionConflictFixture,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const request = requestJson("/api/manuscript");

    await expect(request).rejects.toMatchObject({
      code: "document.revision_conflict",
      category: "conflict",
      message: "Der Inhalt hat sich inzwischen geändert. Lade ihn neu und versuche es erneut.",
      params: { document: "manuscript", expected: 11, actual: 12 },
      retryable: true,
    });
  });
});
