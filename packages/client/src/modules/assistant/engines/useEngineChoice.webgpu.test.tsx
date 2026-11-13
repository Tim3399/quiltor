import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilitiesProvider } from "../../../shared/capabilities";
import type { ClientEngineSlots } from "./registry";
import { useEngineChoice } from "./useEngineChoice";
import { browserWebGpu } from "./webllm/webgpu";

vi.mock("./webllm/webgpu", () => ({ browserWebGpu: vi.fn() }));

const SLOTS: ClientEngineSlots = {
  webllm: { executor: { execute: vi.fn() }, wire: () => ({ kind: "webllm", grammar: true }) },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <CapabilitiesProvider
      value={{ multiUser: false, signOut: false, deviceSync: true, clientAi: true }}
      user={{ serverAi: true }}
    >
      {children}
    </CapabilitiesProvider>
  );
}

describe("the in-browser engine needs a hardware WebGPU adapter (T-61 part 7)", () => {
  beforeEach(() => vi.mocked(browserWebGpu).mockReset());

  it("offers it once the probe finds one", async () => {
    vi.mocked(browserWebGpu).mockResolvedValue(true);
    const { result } = renderHook(() => useEngineChoice(true, SLOTS), { wrapper });
    await waitFor(() => expect(result.current.available).toEqual(["server", "webllm"]));
  });

  it("does not offer it without one, a software adapter included", async () => {
    vi.mocked(browserWebGpu).mockResolvedValue(false);
    const { result } = renderHook(() => useEngineChoice(true, SLOTS), { wrapper });
    await waitFor(() => expect(browserWebGpu).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current.available).toEqual(["server"]);
  });
});
