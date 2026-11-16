import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CapabilitiesProvider, type InstanceCapabilities } from "../../shared/capabilities";
import { AssistantDrawer } from "./AssistantDrawer";
import { api, CHAPTERS, ONLINE, preferences } from "./AssistantDrawer.testSupport";

vi.mock("./engines/registry", () => ({
  clientEngineSlots: () => ({
    cloud: {
      executor: { execute: vi.fn() },
      wire: () => ({ kind: "cloud", provider: "openai" }),
      Panel: () => <p>Schlüssel-Panel</p>,
    },
  }),
}));

function drawer(capabilities: InstanceCapabilities | null) {
  return (
    <I18nProvider>
      <CapabilitiesProvider value={capabilities} user={{ serverAi: true }}>
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
}

const base = { signOut: false, deviceSync: true, clientAi: true };

describe("the header names no engine while the capabilities load (D-T-275-F3, D-205)", () => {
  it("shows no engine name until the capabilities arrive, then the local one", async () => {
    vi.spyOn(preferences, "get").mockReturnValue(null);
    vi.mocked(api.status).mockResolvedValue(ONLINE);
    const view = render(drawer(null));
    expect(await screen.findByText("nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByText(/Server-KI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auf diesem Rechner/)).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    view.rerender(drawer({ ...base, multiUser: false, assistantInstall: true }));
    expect(await screen.findByText("Auf diesem Rechner · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByText(/Server-KI/)).not.toBeInTheDocument();
  });

  it("names the server AI once a hosted server's capabilities arrive", async () => {
    vi.spyOn(preferences, "get").mockReturnValue(null);
    vi.mocked(api.status).mockResolvedValue(ONLINE);
    const view = render(drawer(null));
    expect(await screen.findByText("nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    view.rerender(drawer({ ...base, multiUser: true, assistantInstall: false }));
    expect(await screen.findByText("Server-KI · nur Vorschläge")).toBeInTheDocument();
    // The switch appears only now that the server engine has its name.
    expect(screen.getByRole("radio", { name: "Server-KI" })).toBeInTheDocument();
  });
});
