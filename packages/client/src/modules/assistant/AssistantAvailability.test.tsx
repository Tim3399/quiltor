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

  it("shows installation progress with an accessible progress bar", async () => {
    vi.mocked(api.status).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.installStatus)
      .mockResolvedValueOnce({ ok: true, running: false, phase: "", percent: 0, error: "" })
      .mockResolvedValue({ ok: true, running: true, phase: "Runtime", percent: 42, error: "" });
    setup();
    fireEvent.click(await screen.findByText("Jetzt einrichten"));
    const progress = await screen.findByRole("progressbar", { name: "Laufzeit wird geladen … 42%" });
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
