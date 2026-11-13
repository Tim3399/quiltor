import { describe, expect, it } from "vitest";
import { availableEngines } from "./choice";
import { clientEngineSlots } from "./registry";

function offered(testHooks: boolean | undefined) {
  const slots = clientEngineSlots({ testHooks });
  return {
    slots,
    engines: availableEngines({ serverAi: true, clientAi: true, webgpu: false, slots }),
  };
}

describe("client engine registration (T-61 part 8a)", () => {
  it("registers no cloud slot and offers no option without testHooks", () => {
    for (const testHooks of [undefined, false]) {
      const { slots, engines } = offered(testHooks);
      expect(slots.cloud).toBeUndefined();
      expect(engines).toEqual(["server"]);
    }
    expect(clientEngineSlots(null).cloud).toBeUndefined();
  });

  it("registers the test profile and offers it with testHooks", () => {
    const { slots, engines } = offered(true);
    expect(slots.cloud?.wire()).toEqual({ kind: "cloud", provider: "openai" });
    expect(engines).toEqual(["server", "cloud"]);
  });
});

describe("in-browser engine registration (T-61 part 7)", () => {
  it("registers the webllm slot only with instance.clientAi", () => {
    expect(clientEngineSlots({ clientAi: true }).webllm?.wire()).toEqual({
      kind: "webllm",
      grammar: true,
    });
    expect(clientEngineSlots({ clientAi: false }).webllm).toBeUndefined();
    expect(clientEngineSlots({ clientAi: true, testHooks: true }).cloud).toBeDefined();
  });
});
