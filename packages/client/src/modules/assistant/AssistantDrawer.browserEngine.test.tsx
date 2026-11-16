import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CapabilitiesProvider, type InstanceCapabilities } from "../../shared/capabilities";
import { AssistantDrawer } from "./AssistantDrawer";
import { api, CHAPTERS, ONLINE, preferences } from "./AssistantDrawer.testSupport";

// The product's hosted server offers the in-browser engine alone; this browser has no WebGPU
// unless a test says so (the probe is read once per render).
const gpu = vi.hoisted(() => ({ present: false }));
vi.mock("./engines/registry", () => ({
  clientEngineSlots: (instance: { clientAi?: boolean } | null) =>
    instance?.clientAi === true
      ? {
          webllm: {
            executor: { execute: vi.fn() },
            wire: () => ({ kind: "webllm" }),
            Panel: () => <button type="button">Modell herunterladen</button>,
          },
        }
      : {},
}));
vi.mock("./engines/webllm/webgpu", () => ({ browserWebGpu: async () => gpu.present }));

const COMPOSER = "Figur anlegen, Beziehung ändern, Timeline prüfen …";
const NO_WEBGPU =
  "Die KI im Browser braucht WebGPU, und dieser Browser bietet es nicht an. Ein aktueller Browser mit WebGPU auf einem Gerät mit Grafikchip kann es.";

const HOSTED: InstanceCapabilities = {
  multiUser: true,
  assistantInstall: false,
  signOut: false,
  deviceSync: true,
  clientAi: true,
};

function renderDrawer({
  stored,
  serverAi = true,
  multiUser = true,
  webgpu = false,
  first = multiUser ? HOSTED : { ...HOSTED, multiUser: false, assistantInstall: true },
}: {
  stored?: string;
  webgpu?: boolean;
  serverAi?: boolean;
  multiUser?: boolean;
  /** What the provider holds at first; null is "not loaded yet". */
  first?: InstanceCapabilities | null;
}) {
  gpu.present = webgpu;
  const store = new Map<string, string>();
  if (stored) store.set("quiltor-assistant-engine", stored);
  vi.spyOn(preferences, "get").mockImplementation((key) => store.get(key) ?? null);
  vi.spyOn(preferences, "set").mockImplementation((key, value) => {
    store.set(key, value);
  });
  vi.mocked(api.status).mockResolvedValue(ONLINE as Awaited<ReturnType<typeof api.status>>);
  const tree = (value: InstanceCapabilities | null) => (
    <I18nProvider>
      <CapabilitiesProvider value={value} user={{ serverAi }}>
        <AssistantDrawer
          worldId="world-1"
          figures={{ nodes: [], edges: [] }}
          chapters={CHAPTERS}
          currentChapterId="c1"
          open
          onApply={vi.fn()}
          onNavigate={vi.fn()}
          onBeforeSend={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </CapabilitiesProvider>
    </I18nProvider>
  );
  const view = render(tree(first));
  return { store, arrive: (value: InstanceCapabilities) => view.rerender(tree(value)) };
}

describe("a stored browser choice survives a missing WebGPU (D-205, T-275 F4)", () => {
  it("stays on the browser engine, blocks sending and leaves the switch to the author", async () => {
    const { store } = renderDrawer({ stored: "webllm" });
    expect(await screen.findByText(NO_WEBGPU)).toBeInTheDocument();
    // The choice is still hers: no silent move to the server AI.
    expect(screen.getByRole("radio", { name: "Im Browser" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Server-KI" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Server-KI" })).not.toBeChecked();
    expect(screen.getByText("Im Browser · nur Vorschläge")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Welt aktualisieren" })).toBeDisabled();
    expect(store.get("quiltor-assistant-engine")).toBe("webllm");

    // Only her own click moves her to the server AI.
    fireEvent.click(screen.getByRole("radio", { name: "Server-KI" }));
    expect(store.get("quiltor-assistant-engine")).toBe("server");
    // Server AI alone is no choice any more, so the switch goes; the composer opens.
    expect(screen.getByText("Server-KI · nur Vorschläge")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled());
  });

  it("offers no model download where the model cannot run (D-T-275-F5, F-275-2)", async () => {
    renderDrawer({ stored: "webllm" });
    expect(await screen.findByText(NO_WEBGPU)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modell herunterladen" })).not.toBeInTheDocument();
  });

  it("keeps the earlier default for someone who never chose: the server AI", async () => {
    renderDrawer({});
    expect(await screen.findByText(NO_WEBGPU)).toBeInTheDocument();
    expect(screen.getByText("Server-KI · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Im Browser" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled());
  });

  it("leaves a stored server choice alone", async () => {
    renderDrawer({ stored: "server" });
    expect(await screen.findByText(NO_WEBGPU)).toBeInTheDocument();
    expect(screen.getByText("Server-KI · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Im Browser" })).not.toBeInTheDocument();
  });

  it("changes nothing on a computer of one's own", async () => {
    renderDrawer({ stored: "webllm", multiUser: false });
    expect(await screen.findByText("Auf diesem Rechner · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByText(NO_WEBGPU)).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
  });

  it("changes nothing without the premium role", async () => {
    renderDrawer({ stored: "webllm", serverAi: false });
    expect(await screen.findByText(NO_WEBGPU)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Im Browser" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Server-KI" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("a stored browser choice survives capabilities that are not there yet (D-T-275-F5)", () => {
  it("keeps it and sends nothing while they load, then runs in the browser", async () => {
    const { store, arrive } = renderDrawer({ stored: "webllm", first: null, webgpu: true });
    await screen.findByRole("radio", { name: "Im Browser" });
    // Not loaded: the choice stays and nothing can go out, least of all to the server AI.
    expect(screen.getByRole("radio", { name: "Im Browser" })).toBeChecked();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Welt aktualisieren" })).toBeDisabled();
    expect(store.get("quiltor-assistant-engine")).toBe("webllm");
    expect(api.chat).not.toHaveBeenCalled();

    // Loaded (hosted, premium, WebGPU present): the browser engine is usable.
    arrive(HOSTED);
    await waitFor(() => expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled());
    expect(screen.getByRole("radio", { name: "Im Browser" })).toBeChecked();
    expect(screen.queryByText(NO_WEBGPU)).not.toBeInTheDocument();
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("keeps it while only the whoami fallback stands in, which says nothing of clientAi", async () => {
    const fallback = { multiUser: true, signOut: false, deviceSync: true };
    const { store } = renderDrawer({ stored: "webllm", first: fallback });
    await screen.findByRole("radio", { name: "Im Browser" });
    expect(screen.getByRole("radio", { name: "Im Browser" })).toBeChecked();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(store.get("quiltor-assistant-engine")).toBe("webllm");
  });
});
