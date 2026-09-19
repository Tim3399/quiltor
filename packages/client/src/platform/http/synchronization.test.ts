import { afterEach, describe, expect, it, vi } from "vitest";
import manuscriptWire from "../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import storyWorldWire from "../../../../../contracts/fixtures/application-api/story-world/wire.v1.json";
import storyboardsWire from "../../../../../contracts/fixtures/application-api/storyboards/wire.v1.json";
import { createHttpApplicationState } from "./request";
import { createSynchronizationHttpGateway } from "./synchronization";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LOCAL_FINGERPRINT = "b".repeat(64);
const REMOTE_SNAPSHOT = "a".repeat(64);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusWire(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    configured: true,
    endpoint: "https://cloud.example.test/project",
    mode: "manual",
    state: "conflict",
    localFingerprint: LOCAL_FINGERPRINT,
    baseGeneration: 1,
    remote: { generation: 2, snapshotId: REMOTE_SNAPSHOT },
    lastSyncedAt: "2026-09-19T10:00:00Z",
    account: {
      accountId: "account-1",
      access: "read-write",
      usedBytes: 1024,
      limitBytes: 4096,
      deleteAfter: null,
    },
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("synchronization HTTP gateway", () => {
  it("scopes status, preview, and guarded synchronization to the selected world", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(statusWire()))
      .mockResolvedValueOnce(
        response({
          ok: true,
          generation: 2,
          snapshotId: REMOTE_SNAPSHOT,
          documents: {
            manuscript: manuscriptWire,
            figures: storyWorldWire,
            storyboards: storyboardsWire,
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          status: statusWire({ state: "synced", baseGeneration: 2 }),
          reloadRequired: true,
          localSnapshotId: "c".repeat(64),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    state.activeWorldId = WORLD_ID;
    const gateway = createSynchronizationHttpGateway(state);

    await expect(gateway.status()).resolves.toMatchObject({
      account: { accountId: "account-1" },
      remote: { generation: 2, snapshotId: REMOTE_SNAPSHOT },
    });
    await expect(gateway.preview()).resolves.toMatchObject({
      generation: 2,
      documents: { manuscript: { chapters: expect.any(Array) } },
    });
    await expect(
      gateway.synchronize({
        action: "use-remote",
        expectedGeneration: 2,
        expectedLocalFingerprint: LOCAL_FINGERPRINT,
      }),
    ).resolves.toMatchObject({ reloadRequired: true, localSnapshotId: "c".repeat(64) });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/sync?world=${WORLD_ID}`,
      `/api/sync/preview?world=${WORLD_ID}`,
      "/api/sync",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      action: "use-remote",
      expectedGeneration: 2,
      expectedLocalFingerprint: LOCAL_FINGERPRINT,
      worldId: WORLD_ID,
    });
  });

  it.each([
    ["a non-object envelope", null],
    ["a negative base generation", statusWire({ baseGeneration: -1 })],
    ["a boolean remote generation", statusWire({ remote: { generation: true, snapshotId: null } })],
    ["an invalid synchronization date", statusWire({ lastSyncedAt: "tomorrow" })],
    [
      "an invalid account deletion date",
      statusWire({
        account: {
          accountId: "account-1",
          access: "read-write",
          usedBytes: 1,
          limitBytes: null,
          deleteAfter: "2026-09-19",
        },
      }),
    ],
    ["a configured status without a digest fingerprint", statusWire({ localFingerprint: "local" })],
    [
      "a remote generation without a digest snapshot id",
      statusWire({ remote: { generation: 2, snapshotId: "snapshot-2" } }),
    ],
    [
      "an account without its server identity",
      statusWire({
        account: {
          access: "read-write",
          usedBytes: 1,
          limitBytes: null,
          deleteAfter: null,
        },
      }),
    ],
  ])("rejects %s from the real status boundary", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));

    await expect(
      createSynchronizationHttpGateway(createHttpApplicationState()).status(),
    ).rejects.toMatchObject({ code: "invalid_response", category: "invalid_response" });
  });

  it("rejects malformed remote documents and preview identities", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ok: true,
          generation: 0,
          snapshotId: REMOTE_SNAPSHOT,
          documents: {},
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          generation: 2,
          snapshotId: REMOTE_SNAPSHOT,
          documents: { manuscript: {}, figures: {}, storyboards: {} },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createSynchronizationHttpGateway(createHttpApplicationState());

    await expect(gateway.preview()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(gateway.preview()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects an unsupported synchronization result before accepting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ok: true,
          reloadRequired: false,
          status: statusWire({ mode: "automatic", state: "synced" }),
        }),
      ),
    );

    await expect(
      createSynchronizationHttpGateway(createHttpApplicationState()).synchronize({
        action: "sync",
      }),
    ).rejects.toMatchObject({ code: "invalid_response", category: "invalid_response" });
  });

  it.each([
    [401, "unauthorized", "Bitte melde dich an, um fortzufahren."],
    [403, "forbidden", "Du darfst diese Aktion nicht ausführen."],
    [
      409,
      "conflict",
      "Die gespeicherte Fassung hat sich geändert. Bewahre deinen Entwurf auf und vergleiche ihn mit der gespeicherten Fassung.",
    ],
    [507, "unavailable", "Quiltor ist vorübergehend nicht erreichbar. Versuche es gleich erneut."],
  ])("maps HTTP %i to a localized %s error", async (httpStatus, category, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: false }, httpStatus)));

    await expect(
      createSynchronizationHttpGateway(createHttpApplicationState()).status(),
    ).rejects.toMatchObject({ category, message });
  });

  it("preserves localized synchronization and quota error contracts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ error: { code: "sync.stale_comparison", retryable: false } }, 409),
      )
      .mockResolvedValueOnce(
        response({ error: { code: "cloud.quota_exceeded", params: { limitBytes: 4096 } } }, 507),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createSynchronizationHttpGateway(createHttpApplicationState());

    await expect(gateway.synchronize({ action: "keep-local" })).rejects.toMatchObject({
      code: "sync.stale_comparison",
      category: "conflict",
      message:
        "Seit dem Vergleich wurde das Projekt verändert. Aktualisiere den Status und prüfe die Fassungen erneut.",
      retryable: false,
    });
    await expect(gateway.synchronize({ action: "sync" })).rejects.toMatchObject({
      code: "cloud.quota_exceeded",
      category: "unavailable",
      message:
        "Der Cloud-Speicher ist voll. Dein lokaler Stand bleibt erhalten. Gib Cloud-Speicher frei oder lass das Kontingent erhöhen, bevor du erneut überträgst.",
      params: { limitBytes: 4096 },
    });
  });
});
