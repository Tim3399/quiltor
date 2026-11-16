import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfileId } from "../application";
import { createProviderCallGateway, providerUrl } from "./providerCall";

afterEach(() => vi.unstubAllGlobals());

function call(profile: ProviderProfileId, signal = new AbortController().signal) {
  return createProviderCallGateway().callProvider(profile, { key: "k", body: "{}", signal });
}

describe("provider call (T-61 part 8a)", () => {
  it("calls the test profile at the origin the server allows with QUILTOR_TEST_HOOKS=1", () => {
    const policy = JSON.parse(
      readFileSync(join(process.cwd(), "src/quiltor/bootstrap/csp-policy.json"), "utf8"),
    ) as { testHooksOrigin: string };
    expect(new URL(providerUrl("test")).origin).toBe(policy.testHooksOrigin);
  });

  it("takes no free URL: anything but a known profile id is refused before fetch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    for (const free of ["https://evil.example/v1", "constructor", "__proto__", ""]) {
      await expect(call(free as ProviderProfileId)).rejects.toThrow("Unknown provider profile");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the body with the key and returns status and JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"a":1}', { status: 429 }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(call("test")).resolves.toEqual({ kind: "answer", status: 429, body: { a: 1 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(providerUrl("test"));
    expect(init.body).toBe("{}");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer k");
  });

  it("reports a failed fetch as network and rethrows an abort", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(call("test")).resolves.toEqual({ kind: "network" });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(call("test", controller.signal)).rejects.toThrow("Aborted");
  });
});
