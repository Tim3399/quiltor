import { describe, expect, it } from "vitest";
import desktopFixture from "../../../../../../contracts/fixtures/application-api/capabilities/desktop.v1.json";
import hostedFixture from "../../../../../../contracts/fixtures/application-api/capabilities/hosted.v1.json";
import hostedPremiumFixture from "../../../../../../contracts/fixtures/application-api/capabilities/hosted-premium.v1.json";
import localFixture from "../../../../../../contracts/fixtures/application-api/capabilities/local.v1.json";
import { decodeCapabilitiesV1 } from "./capabilities";

describe("capabilities v1 decoder", () => {
  it.each([
    ["local", localFixture],
    ["desktop", desktopFixture],
    ["hosted", hostedFixture],
    ["hosted-premium", hostedPremiumFixture],
  ])("reads every flag of the %s fixture", (_, fixture) => {
    expect(decodeCapabilitiesV1(fixture)).toEqual({
      instance: fixture.instance,
      user: fixture.user,
    });
  });

  it("ignores flags it does not know and flags that are not real booleans", () => {
    const decoded = decodeCapabilitiesV1({
      ok: true,
      version: 1,
      instance: {
        ...hostedFixture.instance,
        futureFlag: true,
        deviceSync: "false",
        assistantInstall: 0,
        grammarInstall: null,
      },
      user: { serverAi: true, futureFlag: true },
    });
    expect(decoded).toEqual({
      instance: {
        multiUser: true,
        signOut: true,
        writingDataInstall: false,
        clientAi: true,
        testHooks: false,
      },
      user: { serverAi: true },
    });
  });

  it("ignores a serverAi that is not a real boolean", () => {
    expect(
      decodeCapabilitiesV1({ ok: true, version: 1, instance: {}, user: { serverAi: "true" } }),
    ).toEqual({ instance: {}, user: {} });
  });

  it("answers null instead of throwing for something that is not a v1 answer", () => {
    for (const value of [
      null,
      "ok",
      [],
      { ok: false },
      { ok: true, version: 2, instance: {} },
      { ok: true },
    ]) {
      expect(decodeCapabilitiesV1(value)).toBeNull();
    }
    expect(decodeCapabilitiesV1({ ok: true, version: 1, instance: "x" })).toEqual({
      instance: {},
      user: {},
    });
  });
});
