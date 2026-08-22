import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SnapshotDialog } from "./SnapshotDialog";
import { quiltorClient, type BackupLoginStatus } from "../../platform";

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

function show() {
  return render(
    <I18nProvider>
      <SnapshotDialog onClose={vi.fn()} flush={() => Promise.resolve()} />
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
  it("bietet die Anmeldung an, statt in ein 401 hochzuladen", async () => {
    backupLoginStatus.mockResolvedValue(loginStatus());
    backupLoginBegin.mockResolvedValue({
      ok: true,
      authorizeUrl: "https://issuer.example/auth?state=x",
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    show();
    const button = await screen.findByRole("button", { name: /Bei der Sicherung anmelden/ });
    // Der Hochladen-Knopf ist hier gar nicht da: ein deaktivierter Knopf wäre eine
    // Sackgasse, und genau das soll die Anmeldung ersetzen.
    expect(screen.queryByRole("button", { name: /Sichern & hochladen/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://issuer.example/auth?state=x",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    // Die Anmeldung endet im anderen Fenster -- der Dialog muss selbst nachfragen.
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
    // null heißt nicht "nicht erreichbar", sondern "noch nicht beantwortet". Der
    // Unterschied zählt: ein langsamer, aber lebender Anmeldedienst darf nicht
    // dazu führen, dass der Knopf verschwindet und als Fehler dasteht.
    backupLoginStatus.mockResolvedValue(loginStatus({ issuerReachable: null }));
    show();
    expect(await screen.findByText(/wird gerade geprüft/)).toBeInTheDocument();
    expect(screen.queryByText(/antwortet gerade nicht/)).not.toBeInTheDocument();
    // Der Anmeldeknopf bleibt sichtbar, nur noch nicht drückbar -- die Anzeige
    // nimmt kein Urteil vorweg, das der Server noch gar nicht gefällt hat.
    expect(screen.getByRole("button", { name: /Bei der Sicherung anmelden/ })).toBeDisabled();
  });

  it("bietet die Anmeldung an, sobald die Prüfung zurückkommt", async () => {
    backupLoginStatus
      .mockResolvedValueOnce(loginStatus({ issuerReachable: null }))
      .mockResolvedValue(loginStatus({ issuerReachable: true }));
    show();
    expect(await screen.findByText(/wird gerade geprüft/)).toBeInTheDocument();
    // Auf den Zustandswechsel warten, nicht auf das Element: der Knopf steht die
    // ganze Zeit da, er ist nur erst deaktiviert.
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
