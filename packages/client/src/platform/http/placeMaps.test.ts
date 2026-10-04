import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApplicationState, selectWorld } from "./request";
import { createPlaceMapsHttpGateway } from "./placeMaps";

afterEach(() => vi.unstubAllGlobals());

describe("place maps HTTP gateway", () => {
  it("sends image bytes as base64 JSON for the selected world", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "digest", mime: "image/png", width: 1, height: 1, byteSize: 3 }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    selectWorld(state, "world / one");

    await expect(
      createPlaceMapsHttpGateway(state).store(new Blob([Uint8Array.from([1, 2, 3])])),
    ).resolves.toMatchObject({ id: "digest", byteSize: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/place-maps?world=world%20%2F%20one",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "AQID" }),
      }),
    );
  });

  it("gives the legacy request.invalid parser response an upload-specific message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "request.invalid", retryable: false } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      createPlaceMapsHttpGateway(createHttpApplicationState()).store(new Blob(["image"])),
    ).rejects.toMatchObject({
      code: "request.invalid",
      category: "invalid_request",
      message:
        "Das Bild konnte nicht übertragen werden. Versuche es erneut. Falls der Fehler bleibt, melde den Zeitpunkt.",
    });
  });
});
