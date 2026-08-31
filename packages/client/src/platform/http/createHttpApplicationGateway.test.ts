import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformGateway } from "../PlatformGateway";
import { createHttpApplicationGateway } from "./createHttpApplicationGateway";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const platform: PlatformGateway = {
  preferences: { get: () => null, set: () => undefined, remove: () => undefined },
  clipboard: { writeText: async () => undefined },
  externalNavigation: { open: () => undefined },
  files: { save: async () => ({ status: "saved" }) },
};

afterEach(() => vi.unstubAllGlobals());

describe("HTTP application composition", () => {
  it("exposes every application port and shares selected-world state between adapters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ok: true,
          endpoint: null,
          changes: [],
          changeCount: 0,
          suggestedMessage: "Sicherung",
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, commits: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const application = createHttpApplicationGateway(platform);

    expect(Object.keys(application).sort()).toEqual(
      [
        "assistant",
        "backup",
        "documents",
        "history",
        "identity",
        "manuscript",
        "metadata",
        "storyWorld",
        "storyboards",
        "worlds",
        "writingAssistance",
      ].sort(),
    );

    application.worlds.select(WORLD_ID);
    await application.backup.status();
    await application.history.log();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/backup?world=${WORLD_ID}`,
      `/api/history?world=${WORLD_ID}`,
    ]);
  });
});
