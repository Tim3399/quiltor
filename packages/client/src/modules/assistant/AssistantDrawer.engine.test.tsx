import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CapabilitiesProvider } from "../../shared/capabilities";
import { AssistantDrawer } from "./AssistantDrawer";
import { api, CHAPTERS, NOT_INSTALLED, ONLINE, preferences } from "./AssistantDrawer.testSupport";

vi.mock("./engines/registry", () => ({
  clientEngineSlots: () => ({
    cloud: {
      executor: { execute: vi.fn() },
      wire: () => ({ kind: "cloud", provider: "openai" }),
      Panel: () => <p>Schlüssel-Panel</p>,
    },
  }),
}));

const COMPOSER = "Figur anlegen, Beziehung ändern, Timeline prüfen …";

function renderDrawer({
  status = NOT_INSTALLED as object,
  serverAi = true,
  clientAi = true,
  multiUser = false,
} = {}) {
  const stored = new Map<string, string>();
  vi.spyOn(preferences, "get").mockImplementation((key) => stored.get(key) ?? null);
  vi.spyOn(preferences, "set").mockImplementation((key, value) => {
    stored.set(key, value);
  });
  vi.mocked(api.status).mockResolvedValue(status as typeof NOT_INSTALLED);
  render(
    <I18nProvider>
      <CapabilitiesProvider
        value={{
          multiUser,
          assistantInstall: !multiUser,
          signOut: false,
          deviceSync: true,
          clientAi,
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
}

describe("the drawer's header names the engine that computes (T-275, D-205)", () => {
  it("says this computer where the author installs the model herself", async () => {
    renderDrawer({ status: ONLINE });
    expect(await screen.findByText("Auf diesem Rechner · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "KI-Engine" })).not.toBeInTheDocument();
  });

  it("says server AI where accounts sign in with the premium role", async () => {
    renderDrawer({ status: ONLINE, multiUser: true });
    expect(await screen.findByText("Server-KI · nur Vorschläge")).toBeInTheDocument();
  });

  it("follows the switch on a hosted server with the premium role", async () => {
    renderDrawer({ status: ONLINE, multiUser: true });
    fireEvent.click(await screen.findByRole("radio", { name: "Eigener Schlüssel" }));
    expect(screen.getByText("Eigener Schlüssel · nur Vorschläge")).toBeInTheDocument();
  });

  it("names the browser engine without the premium role, never the server", async () => {
    renderDrawer({ status: ONLINE, multiUser: true, serverAi: false });
    expect(await screen.findByText("Eigener Schlüssel · nur Vorschläge")).toBeInTheDocument();
    expect(screen.queryByText("Server-KI · nur Vorschläge")).not.toBeInTheDocument();
  });
});

describe("AssistantDrawer without a local model (D-T-61-8a-F2)", () => {
  it("locks the composer while the server engine is chosen", async () => {
    renderDrawer();
    expect(
      await screen.findByText("Lokales Modell ist noch nicht installiert oder gestartet."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Welt aktualisieren" })).toBeDisabled();
  });

  it("keeps the composer usable with the stand-in browser engine", async () => {
    renderDrawer({ multiUser: true, serverAi: false });
    await screen.findByText("Eigener Schlüssel · nur Vorschläge");
    expect(await screen.findByText("Schlüssel-Panel")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled();
    // The offline notice is about the server's assistant, so it goes with it.
    expect(
      screen.queryByText("Lokales Modell ist noch nicht installiert oder gestartet."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Welt aktualisieren" })).toBeEnabled();
  });

  it("locks the composer without the premium role, even with a runtime", async () => {
    // No client engine offered either: the effective engine falls back to the server.
    renderDrawer({ status: ONLINE, serverAi: false, clientAi: false });
    expect(
      await screen.findByText(
        "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Welt aktualisieren" })).toBeDisabled();
  });

  it("hosted with no engine usable names none and says it once, at the switch", async () => {
    // No premium role and no browser engine: in production a browser without WebGPU.
    renderDrawer({ status: ONLINE, serverAi: false, clientAi: false, multiUser: true });
    expect(await screen.findByText("Keine KI verfügbar")).toBeInTheDocument();
    expect(screen.queryByText("Server-KI · nur Vorschläge")).not.toBeInTheDocument();
    expect(
      screen.getByText("Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
  });

  it("keeps the composer usable with a runtime and the premium role", async () => {
    renderDrawer({ status: ONLINE });
    await screen.findByText("Auf diesem Rechner · nur Vorschläge");
    await waitFor(() => expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled());
  });
});
