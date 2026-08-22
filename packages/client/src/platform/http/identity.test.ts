import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationGateway } from "../application";
import { createPlatformGateway } from "../createPlatformGateway";
import { createHttpApplicationGateway } from ".";

let application: ApplicationGateway;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  application = createHttpApplicationGateway(createPlatformGateway());
});

afterEach(() => vi.unstubAllGlobals());

describe("identity HTTP boundary", () => {
  it("returns the provider logout URL supplied by the validated server boundary", async () => {
    const logoutUrl = "https://identity.example.test/logout?state=safe";
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, logoutUrl }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(application.identity.logout()).resolves.toEqual({ logoutUrl });
    expect(fetchMock).toHaveBeenCalledWith(
      "/logout",
      expect.objectContaining({ cache: "no-store", method: "POST" }),
    );
  });

  it("normalizes an empty provider URL so the application can fall back to /login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, logoutUrl: "" })));

    await expect(application.identity.logout()).resolves.toEqual({});
  });

  it("rejects malformed logout responses with a stable application code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ ok: true, logoutUrl: 42 }))
        .mockResolvedValueOnce(response({ ok: true, logoutUrl: "javascript:alert(1)" })),
    );

    await expect(application.identity.logout()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(application.identity.logout()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
