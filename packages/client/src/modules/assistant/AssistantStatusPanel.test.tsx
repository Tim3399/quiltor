import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CapabilitiesProvider, type InstanceCapabilities } from "../../shared/capabilities";
import { AssistantStatusPanel } from "./AssistantStatusPanel";

const NOT_INSTALLED = {
  available: false,
  reason: "Lokales Modell ist noch nicht installiert oder gestartet.",
  installed: false,
  chunks: 0,
};

function renderPanel(capabilities: InstanceCapabilities | null, installable?: boolean) {
  render(
    <I18nProvider>
      <CapabilitiesProvider value={capabilities}>
        <AssistantStatusPanel
          status={{ ...NOT_INSTALLED, installable }}
          installState={null}
          installProgressId="progress"
          onRetry={vi.fn()}
          onInstall={vi.fn()}
        />
      </CapabilitiesProvider>
    </I18nProvider>,
  );
}

const caps = (assistantInstall?: boolean): InstanceCapabilities => ({
  multiUser: false,
  signOut: false,
  deviceSync: true,
  assistantInstall,
});

describe("assistant install on the server's capabilities (T-102)", () => {
  it.each([
    [false, true, "Wird vom Betreiber eingerichtet", "Jetzt einrichten"],
    [true, false, "Jetzt einrichten", "Wird vom Betreiber eingerichtet"],
  ])(
    "with assistantInstall %s and status installable %s shows %s",
    (flag, installable, shown, hidden) => {
      renderPanel(caps(flag), installable);
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    },
  );

  it("falls back to the status field while the server has not said", () => {
    renderPanel(caps(undefined), false);
    expect(screen.getByText("Wird vom Betreiber eingerichtet")).toBeInTheDocument();
  });
});
