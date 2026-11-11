import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api, NOT_INSTALLED, OFFLINE, ONLINE, setup } from "./AssistantDrawer.testSupport";

describe("assistant availability and installation", () => {
  it("disables input and shows the offline banner when the model is unavailable", async () => {
    vi.mocked(api.status).mockResolvedValue(OFFLINE);
    setup();
    expect(await screen.findByText("Lokales Modell nicht erreichbar")).toBeInTheDocument();
    expect(screen.getByText(OFFLINE.reason)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Figur anlegen, Beziehung ändern, Timeline prüfen …"),
    ).toBeDisabled();
  });

  it('re-checks availability when "Erneut versuchen" is clicked', async () => {
    vi.mocked(api.status).mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(ONLINE);
    setup();
    await screen.findByText("Lokales Modell nicht erreichbar");
    fireEvent.click(screen.getByText("Erneut versuchen"));
    await waitFor(() =>
      expect(screen.queryByText("Lokales Modell nicht erreichbar")).not.toBeInTheDocument(),
    );
    expect(api.status).toHaveBeenCalledTimes(2);
  });

  it("offers installation instead of retry when the model was never installed", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    setup();
    await screen.findByText("Lokales Modell nicht erreichbar");
    expect(screen.getByText("Jetzt einrichten")).toBeInTheDocument();
    expect(screen.queryByText("Erneut versuchen")).not.toBeInTheDocument();
  });

  it("shows the operator note instead of an install button when the server is not installable", async () => {
    vi.mocked(api.status).mockResolvedValue({ ...NOT_INSTALLED, installable: false });
    setup();
    await screen.findByText("Lokales Modell nicht erreichbar");
    expect(screen.getByText("Wird vom Betreiber eingerichtet")).toBeInTheDocument();
    expect(screen.queryByText("Jetzt einrichten")).not.toBeInTheDocument();
    expect(api.install).not.toHaveBeenCalled();
  });

  it("explains the missing premium role instead of reporting the model offline", async () => {
    // The server's answer for a signed-in user without the role (T-58, plan 2.5a).
    vi.mocked(api.status).mockResolvedValue({
      ok: true,
      available: false,
      premium: false,
      installed: false,
      reason: "",
      chunks: 0,
      mode: "local",
    });
    setup();
    expect(
      await screen.findByText(
        "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Lokales Modell nicht erreichbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Jetzt einrichten")).not.toBeInTheDocument();
    expect(screen.queryByText("Erneut versuchen")).not.toBeInTheDocument();
  });

  it("treats a status without the premium field as premium, the way older servers answer", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    setup();
    await screen.findByText("Lokales Modell nicht erreichbar");
    expect(
      screen.queryByText(
        "Der KI-Assistent auf diesem Server steht nur mit Premium-Berechtigung zur Verfügung.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows installation progress with an accessible progress bar", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.installStatus)
      .mockResolvedValueOnce({ ok: true, running: false, phase: "", percent: 0, error: "" })
      .mockResolvedValue({ ok: true, running: true, phase: "Runtime", percent: 42, error: "" });
    setup();
    fireEvent.click(await screen.findByText("Jetzt einrichten"));
    const progress = await screen.findByRole("progressbar", {
      name: "Laufzeit wird geladen … 42%",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "42");
    expect(api.install).toHaveBeenCalledTimes(1);
  });

  it("recovers from a rejected installation request and exposes the error", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.install).mockRejectedValue(new Error("Install failed"));
    setup();

    fireEvent.click(await screen.findByText("Jetzt einrichten"));

    expect(
      await screen.findByText("Einrichtung fehlgeschlagen: Install failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Jetzt einrichten")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("explains a changed download host without naming the host", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.installStatus).mockResolvedValue({
      ok: true,
      running: false,
      phase: "",
      percent: 0,
      error: "Artifact redirect left its trusted HTTPS origins: new.cdn.example",
      errorCode: "download_host_changed",
    });
    setup();

    expect(
      await screen.findByText(
        "Einrichtung fehlgeschlagen: Der Anbieter hat seinen Download-Server geändert. Quiltor nutzt ihn aus Sicherheitsgründen nicht. Ein Update von Quiltor behebt das.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/new\.cdn\.example/)).not.toBeInTheDocument();
  });

  it("re-checks status once installation reports it finished", async () => {
    vi.mocked(api.status).mockResolvedValueOnce(NOT_INSTALLED).mockResolvedValueOnce(ONLINE);
    vi.mocked(api.installStatus).mockResolvedValue({
      ok: true,
      running: false,
      phase: "",
      percent: 100,
      error: "",
    });
    setup();
    fireEvent.click(await screen.findByText("Jetzt einrichten"));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Lokales Modell nicht erreichbar")).not.toBeInTheDocument(),
    );
  });

  it("reopening mid-install restores server progress instead of resetting it", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.installStatus).mockResolvedValue({
      ok: true,
      running: true,
      phase: "Runtime",
      percent: 77,
      error: "",
    });
    const { unmount } = setup();
    await screen.findByText("Laufzeit wird geladen … 77%");
    unmount();

    setup();
    expect(await screen.findByText("Laufzeit wird geladen … 77%")).toBeInTheDocument();
    expect(screen.queryByText("Jetzt einrichten")).not.toBeInTheDocument();
  });
});
