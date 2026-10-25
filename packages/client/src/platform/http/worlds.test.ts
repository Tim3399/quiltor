import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApplicationState } from "./request";
import { createWorldsHttpGateway } from "./worlds";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const world = {
  id: WORLD_ID,
  title: 'Welt mit "Zitat"',
  backupUrl: "https://backup.example.test/welt.git?x=1&y=2",
  updated: "2026-08-21T10:00:00Z",
};
type Gateway = ReturnType<typeof createWorldsHttpGateway>;
const posts = [
  {
    name: "open",
    call: (gateway: Gateway) => gateway.open(WORLD_ID),
    body: `{"id":"${WORLD_ID}"}`,
    decoded: true,
  },
  {
    name: "create",
    call: (gateway: Gateway) => gateway.create(world.title, world.backupUrl),
    body: '{"title":"Welt mit \\"Zitat\\"","backupUrl":"https://backup.example.test/welt.git?x=1&y=2"}',
    decoded: true,
  },
  {
    name: "delete",
    call: (gateway: Gateway) => gateway.delete(WORLD_ID),
    body: `{"id":"${WORLD_ID}"}`,
    decoded: false,
  },
  {
    name: "restore",
    call: (gateway: Gateway) => gateway.restore(WORLD_ID),
    body: `{"id":"${WORLD_ID}"}`,
    decoded: false,
  },
  {
    name: "purge",
    call: (gateway: Gateway) => gateway.purge(WORLD_ID),
    body: `{"id":"${WORLD_ID}"}`,
    decoded: false,
  },
];

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("worlds HTTP port", () => {
  it.each(posts)("preserves $name serialization failure timing before fetch", async (post) => {
    const failure = new Error("Serialization failed");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stringify = vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      const gateway = createWorldsHttpGateway(createHttpApplicationState());
      if (post.decoded) await expect(post.call(gateway)).rejects.toBe(failure);
      else expect(() => post.call(gateway)).toThrow(failure);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it.each(posts)("preserves exact $name POST arguments with or without selection", async (post) => {
    for (const selection of ["", "selected /?&"]) {
      const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, world }));
      vi.stubGlobal("fetch", fetchMock);
      const state = createHttpApplicationState();
      const gateway = createWorldsHttpGateway(state);
      gateway.select(selection);
      await expect(post.call(gateway)).resolves.toEqual({ ok: true, world });
      expect(fetchMock.mock.calls).toStrictEqual([
        [
          `/api/worlds/${post.name}`,
          {
            cache: "no-store",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: post.body,
          },
        ],
      ]);
      expect(state.activeWorldId).toBe(selection);
    }
  });

  it.each(posts)(
    "keeps $name request arguments fixed across a pending selection change",
    async (post) => {
      let resolve!: (value: Response) => void;
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const state = createHttpApplicationState();
      const gateway = createWorldsHttpGateway(state);
      gateway.select(WORLD_ID);
      const request = post.call(gateway);
      expect(fetchMock).toHaveBeenCalledOnce();
      gateway.select("another-world");
      resolve(response({ ok: true, world }));
      await expect(request).resolves.toEqual({ ok: true, world });
      expect(fetchMock.mock.calls[0]).toStrictEqual([
        `/api/worlds/${post.name}`,
        {
          cache: "no-store",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: post.body,
        },
      ]);
      expect(state.activeWorldId).toBe("another-world");
    },
  );

  it.each(posts)("propagates $name transport and structured HTTP errors", async (post) => {
    const gateway = createWorldsHttpGateway(createHttpApplicationState());
    for (const error of [
      new DOMException("Cancelled", "AbortError"),
      new TypeError("Network failed"),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      await expect(post.call(gateway)).rejects.toBe(error);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "storage.locked", params: { world: WORLD_ID }, retryable: true },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(post.call(gateway)).rejects.toMatchObject({
      code: "storage.locked",
      category: "conflict",
      params: { world: WORLD_ID },
      retryable: true,
    });
  });

  it.each(posts)("preserves $name malformed-success and decoder behavior", async (post) => {
    const gateway = createWorldsHttpGateway(createHttpApplicationState());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ok: true, world: { id: WORLD_ID } })),
    );
    if (post.decoded) {
      await expect(post.call(gateway)).rejects.toThrow("Invalid world wire value");
    } else {
      await expect(post.call(gateway)).resolves.toEqual({ ok: true, world: { id: WORLD_ID } });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid json", { status: 200 })),
    );
    if (post.decoded) await expect(post.call(gateway)).rejects.toBeInstanceOf(TypeError);
    else await expect(post.call(gateway)).resolves.toBeNull();
  });

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
    const trashedWorld = {
      ...firstWorld,
      deletedAt: "2026-08-22T10:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, worlds: [firstWorld] }))
      .mockResolvedValueOnce(response({ ok: true, worlds: [trashedWorld] }))
      .mockResolvedValueOnce(response({ ok: true, world: firstWorld }))
      .mockResolvedValueOnce(response({ ok: true, world: secondWorld }))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    const worlds = createWorldsHttpGateway(state);

    await expect(worlds.list()).resolves.toEqual({ ok: true, worlds: [firstWorld] });
    await expect(worlds.listTrash()).resolves.toEqual({ ok: true, worlds: [trashedWorld] });
    await expect(worlds.open(WORLD_ID)).resolves.toEqual({ ok: true, world: firstWorld });
    await expect(worlds.create("Zweite Welt", secondWorld.backupUrl)).resolves.toEqual({
      ok: true,
      world: secondWorld,
    });
    await expect(worlds.delete(WORLD_ID)).resolves.toEqual({ ok: true });
    await expect(worlds.restore(WORLD_ID)).resolves.toEqual({ ok: true });
    await expect(worlds.purge(WORLD_ID)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/worlds",
      "/api/worlds/trash",
      "/api/worlds/open",
      "/api/worlds/create",
      "/api/worlds/delete",
      "/api/worlds/restore",
      "/api/worlds/purge",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ id: WORLD_ID });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      title: "Zweite Welt",
      backupUrl: secondWorld.backupUrl,
    });
    for (const call of fetchMock.mock.calls.slice(4)) {
      expect(JSON.parse(String(call[1]?.body))).toEqual({ id: WORLD_ID });
    }
    for (const call of fetchMock.mock.calls.slice(2)) {
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
    expect(state.selectionGeneration).toBe(1);
    state.revisions.manuscript = 9;
    worlds.select(WORLD_ID);
    expect(state.selectionGeneration).toBe(2);
    expect(state.revisions).toEqual({ manuscript: 0, figures: 0, storyboards: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects trash entries without a valid deletion timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ok: true,
          worlds: [
            {
              id: WORLD_ID,
              title: "Broken",
              backupUrl: "",
              updated: "2026-08-21T10:00:00Z",
              deletedAt: "not-a-date",
            },
          ],
        }),
      ),
    );

    await expect(createWorldsHttpGateway(createHttpApplicationState()).listTrash()).rejects.toThrow(
      "Invalid world wire value",
    );
  });
});
