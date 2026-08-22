import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApplicationState } from "./request";
import { createWorldsHttpGateway } from "./worlds";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("worlds HTTP port", () => {
  it("maps world wires and keeps every command on its dedicated route", async () => {
    const firstWorld = {
      id: WORLD_ID,
      title: "Erste Welt",
      backupUrl: "https://backup.example.test/first.git",
      updated: "2026-08-21T10:00:00Z",
    };
    const secondWorld = {
      ...firstWorld,
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Zweite Welt",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, worlds: [firstWorld] }))
      .mockResolvedValueOnce(response({ ok: true, world: firstWorld }))
      .mockResolvedValueOnce(response({ ok: true, world: secondWorld }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    const worlds = createWorldsHttpGateway(state);

    await expect(worlds.list()).resolves.toEqual({ ok: true, worlds: [firstWorld] });
    await expect(worlds.open(WORLD_ID)).resolves.toEqual({ ok: true, world: firstWorld });
    await expect(worlds.create("Zweite Welt", secondWorld.backupUrl)).resolves.toEqual({
      ok: true,
      world: secondWorld,
    });
    await expect(worlds.delete(WORLD_ID)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/worlds",
      "/api/worlds/open",
      "/api/worlds/create",
      "/api/worlds/delete",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ id: WORLD_ID });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      title: "Zweite Welt",
      backupUrl: secondWorld.backupUrl,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ id: WORLD_ID });
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
  });

  it("stores the selected world in the shared HTTP state without issuing a request", () => {
    const state = createHttpApplicationState();
    const worlds = createWorldsHttpGateway(state);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    worlds.select(WORLD_ID);

    expect(state.activeWorldId).toBe(WORLD_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
