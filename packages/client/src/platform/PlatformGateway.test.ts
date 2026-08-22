import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformGateway } from "./PlatformGateway";
import { createPlatformGateway } from "./createPlatformGateway";
import { createQuiltorClient } from "./QuiltorClient";
import { createApplicationGatewayStub } from "./testing/createApplicationGatewayStub";

describe("PlatformGateway", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps host preferences behind the client boundary", () => {
    const platform = createPlatformGateway();
    platform.preferences.set("theme", "dark");
    expect(platform.preferences.get("theme")).toBe("dark");
    platform.preferences.remove("theme");
    expect(platform.preferences.get("theme")).toBeNull();
  });

  it("composes a host-selected application transport with platform capabilities", () => {
    const platform = createPlatformGateway();
    const application = createApplicationGatewayStub({
      metadata: { version: vi.fn().mockResolvedValue({ ok: true, version: "native-test" }) },
    });

    const client = createQuiltorClient(platform, application);

    expect(client.platform).toBe(platform);
    expect(client.application).toBe(application);
  });

  it("routes clipboard and external navigation through browser capabilities", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const platform = createPlatformGateway();

    await platform.clipboard.writeText("Quiltor");
    platform.externalNavigation.open("https://example.com/sign-in");

    expect(writeText).toHaveBeenCalledWith("Quiltor");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/sign-in",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uses the desktop file capability when the native bridge is present", async () => {
    const invoke = vi.fn().mockImplementation((request) =>
      Promise.resolve({
        version: 1,
        id: request.id,
        ok: true,
        result: { status: "saved" },
      }),
    );
    window.pywebview = { api: { invoke } };
    const platform: PlatformGateway = createPlatformGateway();

    await expect(platform.files.save("book.md", new Blob(["hello"]))).resolves.toEqual({
      status: "saved",
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        operation: "file.save",
        payload: { name: "book.md", content: "aGVsbG8=", encoding: "base64" },
      }),
    );
  });
});
