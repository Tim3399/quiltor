import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  CapabilitiesProvider,
  type InstanceCapabilities,
  type UserCapabilities,
} from "../../shared/capabilities";
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

describe("server AI on the session's capabilities (T-102 D)", () => {
  const PREMIUM_HINT = /Premium/;
  function panel(user: UserCapabilities, premium?: boolean) {
    return (
      <I18nProvider>
        <CapabilitiesProvider value={caps(true)} user={user}>
          <AssistantStatusPanel
            status={{ ...NOT_INSTALLED, premium }}
            installState={null}
            installProgressId="progress"
            onRetry={vi.fn()}
            onInstall={vi.fn()}
          />
        </CapabilitiesProvider>
      </I18nProvider>
    );
  }

  it("shows the hint while the role is missing and drops it once granted, and back", () => {
    const view = render(panel({ serverAi: false }, true));
    expect(screen.getByText(PREMIUM_HINT)).toBeInTheDocument();
    view.rerender(panel({ serverAi: true }, false));
    expect(screen.queryByText(PREMIUM_HINT)).not.toBeInTheDocument();
    view.rerender(panel({ serverAi: false }, true));
    expect(screen.getByText(PREMIUM_HINT)).toBeInTheDocument();
  });

  it("falls back to the status field on a server that does not say", () => {
    const view = render(panel({}, false));
    expect(screen.getByText(PREMIUM_HINT)).toBeInTheDocument();
    view.rerender(panel({}, undefined));
    expect(screen.queryByText(PREMIUM_HINT)).not.toBeInTheDocument();
  });
});
