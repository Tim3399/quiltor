import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manuscriptFixture from "../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import revisionConflict from "../../../../../contracts/fixtures/application-api/structured-error/revision-conflict.v1.json";
import type { ApplicationGateway } from "../application";
import { createPlatformGateway } from "../createPlatformGateway";
import { createHttpApplicationGateway } from ".";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
let application: ApplicationGateway;

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function envelopeWithoutRevision(): Record<string, unknown> {
  const envelope = JSON.parse(JSON.stringify(manuscriptFixture)) as Record<string, unknown>;
  delete envelope.revision;
  return envelope;
}

beforeEach(() => {
  application = createHttpApplicationGateway(createPlatformGateway());
  application.worlds.select(WORLD_ID);
});

afterEach(() => vi.unstubAllGlobals());

describe("document HTTP v1 boundary", () => {
  it("loads the envelope, verifies its revision and exposes only the domain document", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(manuscriptFixture, { ETag: '"7"' }));
    vi.stubGlobal("fetch", fetchMock);

    const manuscript = await application.manuscript.load();

    expect(manuscript.chapters[0].title).toBe("Die Ankunft");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/manuscript?world=${WORLD_ID}`,
      expect.objectContaining({
        headers: { Accept: "application/vnd.quiltor.document.v1+json" },
      }),
    );
  });

  it("saves the same v1 envelope and keeps world routing out of the payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 8 }));
    vi.stubGlobal("fetch", fetchMock);
    const manuscript = await application.manuscript.load();

    await application.manuscript.save(manuscript);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe(`/api/manuscript?world=${WORLD_ID}`);
    expect(init.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        "If-Match": '"7"',
      }),
    );
    expect(body).toEqual(manuscriptFixture);
    expect(body.payload).not.toHaveProperty("worldId");
  });

  it("maps malformed JSON and revision disagreement to a stable application code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ chapters: [] }))
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"9"' })),
    );

    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("uses an ETag fallback only when it is a safe non-negative integer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response(envelopeWithoutRevision(), { ETag: `"${Number.MAX_SAFE_INTEGER}"` }),
        )
        .mockResolvedValueOnce(
          response(envelopeWithoutRevision(), { ETag: `"${Number.MAX_SAFE_INTEGER + 1}"` }),
        )
        .mockResolvedValueOnce(response(envelopeWithoutRevision(), { ETag: '"Infinity"' })),
    );

    await expect(application.manuscript.load()).resolves.toBeDefined();
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects a save response whose ETag disagrees with its revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
        .mockResolvedValueOnce(
          response({ ok: true, zeit: "12:00:00", revision: 8 }, { ETag: '"9"' }),
        ),
    );

    const manuscript = await application.manuscript.load();
    await expect(application.manuscript.save(manuscript)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves the structured revision conflict returned by a save", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, error: revisionConflict }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const manuscript = await application.manuscript.load();

    await expect(application.manuscript.save(manuscript)).rejects.toMatchObject({
      code: "document.revision_conflict",
      category: "conflict",
      params: { document: "manuscript", expected: 11, actual: 12 },
      retryable: true,
    });
  });
});
