/**
 * T-269 phase 2, package C, check 5.1 and 5.6 (implementer/T-269-audit-client.md): addresses
 * the HTTP adapter hands to the browser are http(s) only, and no free URL reaches fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatformGateway } from "../../createPlatformGateway";
import { createHttpApplicationGateway } from "..";
import { providerUrl } from "../providerCall";

afterEach(() => vi.unstubAllGlobals());

describe("T-269 5.1 addresses from the server", () => {
  it("refuses a logout address that is not http or https", async () => {
    const application = createHttpApplicationGateway(createPlatformGateway());
    for (const logoutUrl of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ok: true, logoutUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      await expect(application.identity.logout()).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });
});

describe("T-269 5.6 provider calls", () => {
  it("knows no provider address but its own profiles", () => {
    for (const name of ["__proto__", "constructor", "https://evil.example"]) {
      expect(() => providerUrl(name as never)).toThrow();
    }
  });
});
