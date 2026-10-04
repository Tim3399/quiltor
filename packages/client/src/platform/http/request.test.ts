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
      message:
        "Die gespeicherte Fassung hat sich geändert. Bewahre deinen Entwurf auf und vergleiche ihn mit der gespeicherten Fassung.",
      params: { document: "manuscript", expected: 11, actual: 12 },
      retryable: true,
    });
  });

  it.each([
    ["storage.read_only", "Speicher ist schreibgeschützt."],
    ["storage.full", "Nicht genug Speicherplatz."],
    ["storage.locked", "Das Projekt ist gerade für Schreibzugriffe gesperrt."],
    ["backup.preview_failed", "Die Sicherung konnte nicht für die Vorschau geöffnet werden."],
    ["project_transfer.invalid_archive", "Die Projektdatei ist ungültig oder beschädigt."],
    [
      "project_transfer.unsupported_version",
      "Diese Projektdatei stammt aus einer nicht unterstützten Quiltor-Version.",
    ],
    ["project_transfer.limit_exceeded", "Die Projektdatei überschreitet"],
    ["project_transfer.invalid_asset", "Die Projektdatei enthält eine ungültige"],
    ["project_transfer.publication_failed", "Das neue Projekt konnte nicht veröffentlicht"],
  ])("gives %s a concrete recovery message", async (code, messageStart) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, retryable: true } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(requestJson("/api/manuscript")).rejects.toMatchObject({
      code,
      category: "unavailable",
      message: expect.stringContaining(messageStart),
    });
  });

  it.each([
    ["place_map.image_rejected", "Das Bild kann nicht verwendet werden."],
    ["place_map.invalid_encoding", "Das Bild konnte nicht übertragen werden."],
    ["place_map.invalid_request", "Das Bild konnte nicht übertragen werden. Versuche es erneut."],
  ])("gives %s its concrete image-upload message", async (code, messageStart) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, retryable: false } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(requestJson("/api/place-maps")).rejects.toMatchObject({
      code,
      category: "invalid_request",
      message: expect.stringContaining(messageStart),
      retryable: false,
    });
  });
});
