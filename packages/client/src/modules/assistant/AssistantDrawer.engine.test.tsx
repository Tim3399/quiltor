import { fireEvent, render, screen } from "@testing-library/react";
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

function renderDrawer({ status = NOT_INSTALLED as object, serverAi = true, clientAi = true } = {}) {
  const stored = new Map<string, string>();
  vi.spyOn(preferences, "get").mockImplementation((key) => stored.get(key) ?? null);
  vi.spyOn(preferences, "set").mockImplementation((key, value) => {
    stored.set(key, value);
  });
  vi.mocked(api.status).mockResolvedValue(status as typeof NOT_INSTALLED);
  render(
    <I18nProvider>
      <CapabilitiesProvider
        value={{ multiUser: false, signOut: false, deviceSync: true, clientAi }}
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

describe("AssistantDrawer without a local model (D-T-61-8a-F2)", () => {
  it("locks the composer while the server engine is chosen", async () => {
    renderDrawer();
    expect(
      await screen.findByText("Lokales Modell ist noch nicht installiert oder gestartet."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    ).toBeDisabled();
  });

  it("keeps the composer usable with a browser engine", async () => {
    renderDrawer();
    await screen.findByText("Lokales Modell ist noch nicht installiert oder gestartet.");
    fireEvent.click(screen.getByRole("radio", { name: "Eigener Schlüssel" }));
    expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled();
    // The offline notice is about the server's assistant, so it goes with it.
    expect(
      screen.queryByText("Lokales Modell ist noch nicht installiert oder gestartet."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    ).toBeEnabled();
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
    expect(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    ).toBeDisabled();
  });

  it("keeps the composer usable with a runtime and the premium role", async () => {
    renderDrawer({ status: ONLINE });
    await screen.findByRole("radio", { name: "Eigener Schlüssel" });
    expect(screen.getByPlaceholderText(COMPOSER)).toBeEnabled();
  });
});
