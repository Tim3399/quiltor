import { describe, expect, it } from "vitest";
import { availableEngines } from "./choice";
import { clientEngineSlots } from "./registry";

// Without the premium role, where a client engine stands in for the server AI (D-205).
function offered(testHooks: boolean | undefined) {
  const slots = clientEngineSlots({ testHooks });
  return {
    slots,
    engines: availableEngines({
      serverAi: false,
      clientAi: true,
      webgpu: false,
      ownComputer: false,
      slots,
    }),
  };
}

describe("client engine registration (T-61 part 8a)", () => {
  it("registers no cloud slot and offers no option without testHooks", () => {
    for (const testHooks of [undefined, false]) {
      const { slots, engines } = offered(testHooks);
      expect(slots.cloud).toBeUndefined();
      expect(engines).toEqual([]);
    }
    expect(clientEngineSlots(null).cloud).toBeUndefined();
  });

  it("registers the test profile and offers it with testHooks", () => {
    const { slots, engines } = offered(true);
    expect(slots.cloud?.wire()).toEqual({ kind: "cloud", provider: "openai" });
    expect(engines).toEqual(["cloud"]);
  });

  it("offers each operating mode its engines (D-205, T-275 Nachtrag 3)", () => {
    const slots = clientEngineSlots({ testHooks: true, clientAi: true });
    const offer = { clientAi: true, webgpu: true, slots };
    // On a computer of one's own: the model there, nothing else.
    expect(availableEngines({ ...offer, serverAi: true, ownComputer: true })).toEqual(["server"]);
    // Hosted with the premium role: the server AI and the browser engines.
    expect(availableEngines({ ...offer, serverAi: true, ownComputer: false })).toEqual([
      "server",
      "webllm",
      "cloud",
    ]);
    // Hosted without it: the browser engines only.
    expect(availableEngines({ ...offer, serverAi: false, ownComputer: false })).toEqual([
      "webllm",
      "cloud",
    ]);
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
