import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { CapabilitiesProvider, type InstanceCapabilities } from "../../shared/capabilities";
import { AssistantStatusPanel } from "./AssistantStatusPanel";

// The test profile's cloud slot is what the suite sees with testHooks; a product server offers
// the in-browser engine alone (registry.ts). `slots.product` switches to that.
const slots = vi.hoisted(() => ({ product: false }));

vi.mock("./engines/registry", () => {
  const cloud = {
    executor: { execute: vi.fn() },
    wire: () => ({ kind: "cloud", provider: "openai" }),
    Panel: () => <p>Schlüssel-Panel</p>,
  };
  const webllm = {
    executor: { execute: vi.fn() },
    wire: () => ({ kind: "webllm" }),
    Panel: () => <p>Modell-Panel</p>,
  };
  const all = { cloud, webllm };
  const product = { webllm };
  return { clientEngineSlots: () => (slots.product ? product : all) };
});

// The adapter probe itself is tested in engines/webllm; here a navigator.gpu stands for a
// hardware adapter, read anew per render rather than once per page.
vi.mock("./engines/webllm/webgpu", () => ({
  browserWebGpu: async () => "gpu" in navigator,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  slots.product = false;
});

const LOCKED = "Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.";
const NO_WEBGPU =
  "Die KI im Browser braucht WebGPU, und dieser Browser bietet es nicht an. Ein aktueller Browser mit WebGPU auf einem Gerät mit Grafikchip kann es.";

/** Lets the WebGPU probe answer, which happens after the first render. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

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
        value={{
          multiUser: false,
          assistantInstall: !instance.multiUser,
          signOut: false,
          deviceSync: true,
          ...instance,
        }}
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

describe("engine choice in the assistant status (T-61, D-205, T-275 Nachtrag 3)", () => {
  it("offers no choice without client engines on this server", () => {
    renderPanel({ clientAi: false });
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
    expect(screen.getByText("Lokales Modell nicht erreichbar")).toBeInTheDocument();
  });

  it("on a computer of one's own the model there is the only engine, WebGPU or not", async () => {
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    try {
      renderPanel({ clientAi: true });
      // The probe resolves after the first render; the computer must still be alone then.
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
      expect(screen.queryByText("Modell-Panel")).not.toBeInTheDocument();
      expect(screen.getByText("Lokales Modell nicht erreichbar")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hosted with the premium role offers the server AI and the browser engines", async () => {
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    try {
      const stored = renderPanel({ clientAi: true, multiUser: true });
      expect(await screen.findByRole("radio", { name: "Im Browser" })).toBeEnabled();
      expect(screen.getByRole("radio", { name: "Server-KI" })).toBeChecked();
      expect(
        screen.queryByText("Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung."),
      ).not.toBeInTheDocument();
      // A text need not go to the server: the browser engine can be chosen instead.
      fireEvent.click(screen.getByRole("radio", { name: "Eigener Schlüssel" }));
      expect(stored.get("quiltor-assistant-engine")).toBe("cloud");
      expect(screen.getByText("Schlüssel-Panel")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hosted without the premium role shows the server AI greyed out, with a reachable reason", async () => {
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    renderPanel({ clientAi: true, multiUser: true }, false);
    const choice = screen.getByRole("radiogroup", { name: "KI-Engine" });
    expect(screen.getByRole("radio", { name: "Server-KI" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Eigener Schlüssel" })).toBeChecked();
    // The reason describes the switch, so a screen reader reads it with the focused choice.
    expect(choice).toHaveAccessibleDescription(
      "Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.",
    );
    // The reason is no standing note but a tooltip on the greyed-out option (T-275-F6).
    const server = screen.getByRole("radio", { name: "Server-KI" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(server).toHaveAccessibleDescription(LOCKED);
    fireEvent.focus(server);
    expect(screen.getByRole("tooltip")).toHaveTextContent(LOCKED);
    fireEvent.click(server);
    expect(server).not.toBeChecked();
    expect(screen.getByText("Schlüssel-Panel")).toBeInTheDocument();
    expect(screen.queryByText("Lokales Modell nicht erreichbar")).not.toBeInTheDocument();
  });
});

describe("the product's browser engine on a hosted server (D-T-275-F1)", () => {
  it("with the premium role and WebGPU offers the server AI and the browser, no own key", async () => {
    slots.product = true;
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    renderPanel({ clientAi: true, multiUser: true });
    expect(await screen.findByRole("radio", { name: "Im Browser" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Server-KI" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Eigener Schlüssel" })).not.toBeInTheDocument();
    expect(screen.queryByText(NO_WEBGPU)).not.toBeInTheDocument();
  });

  it("without the premium role but with WebGPU the browser engine runs, the server AI is greyed out", async () => {
    slots.product = true;
    vi.stubGlobal("navigator", { ...navigator, gpu: {} });
    renderPanel({ clientAi: true, multiUser: true }, false);
    expect(await screen.findByRole("radio", { name: "Im Browser" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Server-KI" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("radiogroup", { name: "KI-Engine" })).toHaveAccessibleDescription(
      LOCKED,
    );
    expect(screen.getByText("Modell-Panel")).toBeInTheDocument();
    expect(screen.queryByText(NO_WEBGPU)).not.toBeInTheDocument();
  });

  it("without the premium role and without WebGPU says why neither engine can run", async () => {
    slots.product = true;
    vi.stubGlobal("navigator", {});
    renderPanel({ clientAi: true, multiUser: true }, false);
    await settle();
    const choice = await screen.findByRole("radiogroup", { name: "KI-Engine" });
    expect(screen.getByRole("radio", { name: "Server-KI" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("radio", { name: "Im Browser" })).not.toBeInTheDocument();
    // Both reasons describe the switch, so the focused choice reads them out.
    expect(choice).toHaveAccessibleDescription(`${LOCKED} ${NO_WEBGPU}`);
    // The note at the switch says it already; the premium alert would say it twice.
    expect(
      screen.queryByText(
        "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
      ),
    ).not.toBeInTheDocument();
  });

  it("on a computer of one's own there is no WebGPU note, only the computer", async () => {
    slots.product = true;
    vi.stubGlobal("navigator", {});
    renderPanel({ clientAi: true });
    await settle();
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
    expect(screen.queryByText(NO_WEBGPU)).not.toBeInTheDocument();
    expect(screen.queryByText(LOCKED)).not.toBeInTheDocument();
  });
});
