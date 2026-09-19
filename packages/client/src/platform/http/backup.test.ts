import { afterEach, describe, expect, it, vi } from "vitest";
import manuscriptWire from "../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import storyWorldWire from "../../../../../contracts/fixtures/application-api/story-world/wire.v1.json";
import storyboardsWire from "../../../../../contracts/fixtures/application-api/storyboards/wire.v1.json";
import backupGatewayError from "../../../../../contracts/fixtures/application-api/structured-error/backup-gateway.v1.json";
import { createBackupHttpGateway } from "./backup";
import { createHttpApplicationState } from "./request";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("backup HTTP port", () => {
  it("scopes query operations to the selected world and preserves their route semantics", async () => {
    const statusWire = {
      ok: true,
      endpoint: "https://backup.example.test/repository.git",
      changes: ["manuscript.json"],
      changeCount: 1,
      suggestedMessage: "Kapitel sichern",
      lastSuccessfulTransfer: "2026-09-19T10:30:00Z",
      transferredSnapshotId: "snapshot-confirmed",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(statusWire))
      .mockResolvedValueOnce(
        response({ ok: true, configured: true, hosted: false, endpoint: "remote", signedIn: true }),
      )
      .mockResolvedValueOnce(response({ ok: true, authorizeUrl: "https://login.example.test" }))
      .mockResolvedValueOnce(response({ ok: true, signedIn: false }))
      .mockResolvedValueOnce(response({ ok: true, backups: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    state.activeWorldId = WORLD_ID;
    const backup = createBackupHttpGateway(state);

    await expect(backup.status()).resolves.toEqual(statusWire);
    await backup.loginStatus();
    await backup.beginLogin();
    await backup.signOut();
    await backup.list();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/backup?world=${WORLD_ID}`,
      `/api/backup/login?world=${WORLD_ID}`,
      `/api/backup/login?world=${WORLD_ID}`,
      `/api/backup/logout?world=${WORLD_ID}`,
      `/api/backups?world=${WORLD_ID}`,
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    for (const index of [2, 3]) {
      expect(fetchMock.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({ method: "POST", body: "{}" }),
      );
    }
  });

  it("puts world ownership into snapshot and restore command bodies", async () => {
    const savedStatus = {
      ok: true as const,
      endpoint: null,
      changes: ["figures.json"],
      changeCount: 1,
      suggestedMessage: "Figuren sichern",
      lastSuccessfulTransfer: null,
      transferredSnapshotId: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, log: ["saved"], status: savedStatus }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    state.activeWorldId = WORLD_ID;
    const backup = createBackupHttpGateway(state);

    await expect(backup.saveSnapshot("Neue Fassung", true)).resolves.toEqual({
      ok: true,
      log: ["saved"],
      status: savedStatus,
    });
    await expect(backup.restore("snapshot-1.zip")).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/backup",
      "/api/backups/restore",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      message: "Neue Fassung",
      push: true,
      worldId: WORLD_ID,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "snapshot-1.zip",
      worldId: WORLD_ID,
    });
  });

  it("preserves a transfer-status warning and rejects unknown snapshot warnings", async () => {
    const savedStatus = {
      ok: true as const,
      endpoint: "https://backup.example.test/repository.git",
      changes: [],
      changeCount: 0,
      suggestedMessage: "Sicherung",
      lastSuccessfulTransfer: "2026-09-18T09:15:00Z",
      transferredSnapshotId: "snapshot-previous",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ok: true,
          log: ["upload confirmed"],
          status: savedStatus,
          warnings: ["backup.transfer_status_failed"],
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          log: ["upload confirmed"],
          status: savedStatus,
          warnings: ["unknown"],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const backup = createBackupHttpGateway(createHttpApplicationState());

    await expect(backup.saveSnapshot("Sicherung", true)).resolves.toEqual({
      ok: true,
      log: ["upload confirmed"],
      status: savedStatus,
      warnings: ["backup.transfer_status_failed"],
    });
    await expect(backup.saveSnapshot("Sicherung", true)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("loads host storage details and decodes an isolated backup preview", async () => {
    const storage = {
      databasePath: "C:\\Quiltor\\world.sqlite3",
      backupDirectory: "C:\\Quiltor\\backups",
      lastSuccessfulBackup: "2026-09-19T10:00:00Z",
      scope: "application-host" as const,
      canOpenFolder: false as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, storage }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          documents: {
            manuscript: manuscriptWire,
            figures: storyWorldWire,
            storyboards: storyboardsWire,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    state.activeWorldId = WORLD_ID;
    const backup = createBackupHttpGateway(state);

    await expect(backup.location()).resolves.toEqual({ ok: true, storage });
    const preview = await backup.preview("Sicherung 1.sqlite3");
    expect(preview.documents.manuscript.chapters[0].title).toBeTruthy();
    expect(preview.documents.figures.nodes.length).toBeGreaterThan(0);
    expect(preview.documents.storyboards.boards.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/backups/location?world=${WORLD_ID}`,
      `/api/backups/preview?name=Sicherung%201.sqlite3&world=${WORLD_ID}`,
    ]);
  });

  it("rejects malformed storage and preview success payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, storage: { canOpenFolder: true } }))
      .mockResolvedValueOnce(response({ ok: true, documents: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const backup = createBackupHttpGateway(createHttpApplicationState());

    await expect(backup.location()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(backup.preview("broken.sqlite3")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves the committed-restore mirror warning and rejects unknown warnings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, warnings: ["backup.mirror_failed"] }))
      .mockResolvedValueOnce(response({ ok: true, warnings: ["backup.unknown"] }));
    vi.stubGlobal("fetch", fetchMock);
    const backup = createBackupHttpGateway(createHttpApplicationState());

    await expect(backup.restore("snapshot-1")).resolves.toEqual({
      ok: true,
      warnings: ["backup.mirror_failed"],
    });
    await expect(backup.restore("snapshot-2")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves the shared structured backup error across the HTTP boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: backupGatewayError }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const request = createBackupHttpGateway(createHttpApplicationState()).saveSnapshot(
      "Sichern",
      true,
    );

    await expect(request).rejects.toMatchObject({
      code: backupGatewayError.code,
      category: "unavailable",
      params: backupGatewayError.params,
      retryable: backupGatewayError.retryable,
    });
  });

  it("rejects malformed successful backup payloads as invalid responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true })));

    await expect(
      createBackupHttpGateway(createHttpApplicationState()).status(),
    ).rejects.toMatchObject({ code: "invalid_response", category: "invalid_response" });
  });
});
