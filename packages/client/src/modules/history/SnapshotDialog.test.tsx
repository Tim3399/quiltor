import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { type BackupLoginStatus, quiltorClient } from "../../platform";
import { SnapshotDialog } from "./SnapshotDialog";

const backupStatus = vi.fn(),
  backupLoginStatus = vi.fn(),
  backupLoginBegin = vi.fn(),
  backupLogout = vi.fn(),
  saveSnapshot = vi.fn();

vi.spyOn(quiltorClient.application.backup, "status").mockImplementation(() => backupStatus());
vi.spyOn(quiltorClient.application.backup, "loginStatus").mockImplementation(() =>
  backupLoginStatus(),
);
vi.spyOn(quiltorClient.application.backup, "beginLogin").mockImplementation(() =>
  backupLoginBegin(),
);
vi.spyOn(quiltorClient.application.backup, "signOut").mockImplementation(() => backupLogout());
vi.spyOn(quiltorClient.application.backup, "saveSnapshot").mockImplementation((message, upload) =>
  saveSnapshot(message, upload),
);

function loginStatus(overrides: Partial<BackupLoginStatus> = {}): BackupLoginStatus {
  return {
    ok: true,
    configured: true,
    hosted: false,
    endpoint: "https://backup.example",
    signedIn: false,
    issuerReachable: true,
    ...overrides,
  };
}

function show(flush: () => Promise<void> = () => Promise.resolve()) {
  return render(
    <I18nProvider>
      <SnapshotDialog onClose={vi.fn()} flush={flush} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  const status = {
    ok: true,
    endpoint: "https://backup.example",
    changeCount: 1,
    changes: [],
    suggestedMessage: "Kapitel 3",
  };
  backupStatus.mockResolvedValue(status);
  saveSnapshot.mockResolvedValue({ ok: true, log: ["fertig"], status });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SnapshotDialog", () => {
  it("nutzt beschriftete Design-Controls mit unveränderter Speichern-Semantik", async () => {
    backupLoginStatus.mockResolvedValue(
      loginStatus({ signedIn: true, email: "autorin@example.org" }),
    );
    let resolveFlush!: () => void;
    const flush = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve;
          }),
      );
    show(flush);

    const message = await screen.findByRole("textbox", { name: "Was hat sich geändert?" });
    const saveOnly = screen.getByRole("button", { name: "Nur lokal sichern" });
    const upload = screen.getByRole("button", { name: "Sichern & hochladen" });

    expect(message.parentElement).toHaveClass("ui-field");
    expect(message).toHaveValue("Kapitel 3");
    expect(saveOnly).toHaveClass("ui-button");
    expect(saveOnly).toHaveAttribute("type", "button");
    expect(upload).toHaveAttribute("data-appearance", "primary");

    fireEvent.change(message, { target: { value: "Kapitel 3 überarbeitet" } });
    fireEvent.click(saveOnly);

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    expect(saveOnly).toBeDisabled();
    expect(upload).toBeDisabled();
    expect(saveSnapshot).not.toHaveBeenCalled();

    await act(async () => resolveFlush());
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalledWith("Kapitel 3 überarbeitet", false));
    expect(saveOnly).toBeEnabled();
  });

  it("bietet die Anmeldung an, statt in ein 401 hochzuladen", async () => {
    backupLoginStatus.mockResolvedValue(loginStatus());
    backupLoginBegin.mockResolvedValue({
      ok: true,
      authorizeUrl: "https://issuer.example/auth?state=x",
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    show();
    const button = await screen.findByRole("button", { name: /Bei der Sicherung anmelden/ });
    // The upload button is not here at all: a disabled button would be a dead end, and
    // the sign-in is exactly what replaces it.
    expect(screen.queryByRole("button", { name: /Sichern & hochladen/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://issuer.example/auth?state=x",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    // The sign-in finishes in the other window -- the dialog has to ask for itself.
    await waitFor(() => expect(backupLoginStatus.mock.calls.length).toBeGreaterThan(1), {
      timeout: 4000,
    });
  });

  it("meldet einen abgelehnten Anmeldebeginn, statt ihn zu verschlucken", async () => {
    backupLoginStatus.mockResolvedValue(loginStatus());
    backupLoginBegin.mockRejectedValue(new Error("Kein Endpunkt eingerichtet."));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Bei der Sicherung anmelden/ }));
    expect(await screen.findByText("Kein Endpunkt eingerichtet.")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("bietet keine Anmeldung an, wenn der Anmeldedienst nicht erreichbar ist", async () => {
    backupLoginStatus.mockResolvedValue(loginStatus({ issuerReachable: false }));
    show();
    expect(
      await screen.findByText(/Der Anmeldedienst des Ziels antwortet gerade nicht/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bei der Sicherung anmelden/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sichern & hochladen/ })).toBeDisabled();
  });

  it('sagt "wird geprüft", solange der Anmeldedienst noch keine Antwort gegeben hat', async () => {
    // null does not mean "unreachable" but "not answered yet". The difference counts: a
    // slow but living sign-in service must not make the button disappear and stand there
    // as a failure.
    backupLoginStatus.mockResolvedValue(loginStatus({ issuerReachable: null }));
    show();
    expect(await screen.findByText(/wird gerade geprüft/)).toBeInTheDocument();
    expect(screen.queryByText(/antwortet gerade nicht/)).not.toBeInTheDocument();
    // The sign-in button stays visible, only not yet pressable -- the display pre-empts
    // no verdict the server has not reached yet.
    expect(screen.getByRole("button", { name: /Bei der Sicherung anmelden/ })).toBeDisabled();
  });

  it("bietet die Anmeldung an, sobald die Prüfung zurückkommt", async () => {
    backupLoginStatus
      .mockResolvedValueOnce(loginStatus({ issuerReachable: null }))
      .mockResolvedValue(loginStatus({ issuerReachable: true }));
    show();
    expect(await screen.findByText(/wird gerade geprüft/)).toBeInTheDocument();
    // Wait for the state to change, not for the element: the button is there the whole
    // time, it is merely disabled at first.
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: /Bei der Sicherung anmelden/ })).toBeEnabled(),
      { timeout: 5000 },
    );
  });

  it("lädt hoch und zeigt das Konto, sobald angemeldet", async () => {
    backupLoginStatus.mockResolvedValue(
      loginStatus({ signedIn: true, email: "autorin@example.org" }),
    );
    show();
    const upload = await screen.findByRole("button", { name: /Sichern & hochladen/ });
    await waitFor(() => expect(upload).toBeEnabled());
    fireEvent.click(upload);
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalledWith("Kapitel 3", true));
    expect(screen.getByText("autorin@example.org")).toBeInTheDocument();
    backupLogout.mockResolvedValue({ ok: true, signedIn: false });
    backupLoginStatus.mockResolvedValue(loginStatus({ signedIn: false }));
    fireEvent.click(screen.getByRole("button", { name: /Abmelden/ }));
    await waitFor(() => expect(backupLogout).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: /Bei der Sicherung anmelden/ }),
    ).toBeInTheDocument();
  });

  it("bleibt ohne eingerichtetes Ziel beim toten Knopf, weil es nichts anzumelden gibt", async () => {
    backupStatus.mockResolvedValue({
      ok: true,
      endpoint: "",
      changeCount: 0,
      changes: [],
      suggestedMessage: "Sicherung",
    });
    backupLoginStatus.mockResolvedValue(
      loginStatus({ configured: false, endpoint: "", issuerReachable: false }),
    );
    show();
    expect(await screen.findByRole("button", { name: /Sichern & hochladen/ })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Bei der Sicherung anmelden/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Der Anmeldedienst des Ziels antwortet gerade nicht/),
    ).not.toBeInTheDocument();
  });
});
