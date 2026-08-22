import { describe, expect, it } from "vitest";
import { logoutDestination } from "./useShellStatus";

describe("logout destination", () => {
  it("uses the validated provider URL and otherwise falls back to the local login", () => {
    expect(logoutDestination({ logoutUrl: "https://identity.example.test/logout" })).toBe(
      "https://identity.example.test/logout",
    );
    expect(logoutDestination({})).toBe("/login");
  });
});
