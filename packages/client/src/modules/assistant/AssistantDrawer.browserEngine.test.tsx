import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CapabilitiesProvider } from "../../shared/capabilities";
import { AssistantDrawer } from "./AssistantDrawer";
import { api, CHAPTERS, ONLINE, preferences } from "./AssistantDrawer.testSupport";

// The product's hosted server offers the in-browser engine alone; this browser has no WebGPU.
vi.mock("./engines/registry", () => ({
  clientEngineSlots: () => ({
    webllm: {
      executor: { execute: vi.fn() },
      wire: () => ({ kind: "webllm" }),
      Panel: () => <p>Modell-Panel</p>,
    },
  }),
}));
vi.mock("./engines/webllm/webgpu", () => ({ browserWebGpu: async () => false }));

const COMPOSER = "Figur anlegen, Beziehung ändern, Timeline prüfen …";
const NO_WEBGPU =
  "Die KI im Browser braucht WebGPU, und dieser Browser bietet es nicht an. Ein aktueller Browser mit WebGPU auf einem Gerät mit Grafikchip kann es.";

function renderDrawer({
  stored,
  serverAi = true,
  multiUser = true,
}: {
  stored?: string;
  serverAi?: boolean;
  multiUser?: boolean;
}) {
  const store = new Map<string, string>();
  if (stored) store.set("quiltor-assistant-engine", stored);
  vi.spyOn(preferences, "get").mockImplementation((key) => store.get(key) ?? null);
  vi.spyOn(preferences, "set").mockImplementation((key, value) => {
    store.set(key, value);
  });
  vi.mocked(api.status).mockResolvedValue(ONLINE as Awaited<ReturnType<typeof api.status>>);
  render(
    <I18nProvider>
      <CapabilitiesProvider
        value={{
          multiUser,
          assistantInstall: !multiUser,
          signOut: false,
          deviceSync: true,
          clientAi: true,
        }}
        user={{ serverAi }}
      >
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
    </I18nProvider>,
  );
  return store;
}

describe("a stored browser choice survives a missing WebGPU (D-205, T-275 F4)", () => {
  it("stays on the browser engine, blocks sending and leaves the switch to the author", async () => {
    const store = renderDrawer({ stored: "webllm" });
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
    expect(screen.getByRole("radio", { name: "Server-KI" })).toBeDisabled();
  });
});
