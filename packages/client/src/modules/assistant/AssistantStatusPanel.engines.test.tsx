import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { CapabilitiesProvider, type InstanceCapabilities } from "../../shared/capabilities";
import { AssistantStatusPanel } from "./AssistantStatusPanel";

vi.mock("./engines/registry", () => ({
  clientEngineSlots: () => ({
    cloud: {
      executor: { execute: vi.fn() },
      wire: () => ({ kind: "cloud", provider: "openai" }),
      Panel: () => <p>Schlüssel-Panel</p>,
    },
    webllm: {
      executor: { execute: vi.fn() },
      wire: () => ({ kind: "webllm" }),
      Panel: () => <p>Modell-Panel</p>,
    },
  }),
}));

afterEach(() => vi.restoreAllMocks());

const UNAVAILABLE = {
  available: false,
  reason: "Lokales Modell ist noch nicht installiert oder gestartet.",
  installed: false,
  chunks: 0,
};

function renderPanel(instance: Partial<InstanceCapabilities>, serverAi = true) {
  const stored = new Map<string, string>();
  vi.spyOn(quiltorClient.platform.preferences, "get").mockImplementation(
    (key) => stored.get(key) ?? null,
  );
  vi.spyOn(quiltorClient.platform.preferences, "set").mockImplementation((key, value) => {
    stored.set(key, value);
  });
  render(
    <I18nProvider>
      <CapabilitiesProvider
        value={{ multiUser: false, signOut: false, deviceSync: true, ...instance }}
        user={{ serverAi }}
      >
        <AssistantStatusPanel
          status={UNAVAILABLE}
          installState={null}
          installProgressId="progress"
          onRetry={vi.fn()}
          onInstall={vi.fn()}
        />
      </CapabilitiesProvider>
    </I18nProvider>,
  );
  return stored;
}

describe("engine choice in the assistant status (T-61)", () => {
  it("offers no choice without client engines on this server", () => {
    renderPanel({ clientAi: false });
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
    expect(screen.getByText("Lokales Modell nicht erreichbar")).toBeInTheDocument();
  });

  it("offers the own key next to the server, and in the browser only with WebGPU", () => {
    renderPanel({ clientAi: true });
    const choice = screen.getByRole("radiogroup", { name: "KI-Engine" });
    expect(choice).toHaveTextContent("Server-KI");
    expect(choice).toHaveTextContent("Eigener Schlüssel");
    // jsdom has no navigator.gpu.
    expect(choice).not.toHaveTextContent("Im Browser");
  });

  it("offers the browser engine when WebGPU is there", () => {
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    try {
      renderPanel({ clientAi: true });
      expect(screen.getByRole("radiogroup", { name: "KI-Engine" })).toHaveTextContent("Im Browser");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stores the choice and shows the engine's own panel instead of the server's state", () => {
    const stored = renderPanel({ clientAi: true });
    fireEvent.click(screen.getByRole("radio", { name: "Eigener Schlüssel" }));
    expect(stored.get("quiltor-assistant-engine")).toBe("cloud");
    expect(screen.getByText("Schlüssel-Panel")).toBeInTheDocument();
    expect(screen.queryByText("Lokales Modell nicht erreichbar")).not.toBeInTheDocument();
  });

  it("without the server AI the own key is the only engine and needs no choice", () => {
    renderPanel({ clientAi: true }, false);
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
    expect(screen.getByText("Schlüssel-Panel")).toBeInTheDocument();
  });
});
