import { afterEach, describe, expect, it, vi } from "vitest";
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
