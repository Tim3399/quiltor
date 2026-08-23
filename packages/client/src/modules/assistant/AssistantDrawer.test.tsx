import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api, reply, setup } from "./AssistantDrawer.testSupport";

describe("AssistantDrawer shell", () => {
  it("shows the empty-state actions without sending until the user submits", async () => {
    const { onClose } = setup();
    expect(await screen.findByText("Was soll ich in der Welt nachtragen?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Fehlende Figuren finden"));
    expect(
      screen.getByPlaceholderText("Figur anlegen, Beziehung ändern, Timeline prüfen …"),
    ).toHaveValue("Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.");
    expect(api.chat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Assistent schließen"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts the explicit extraction workflow for the current chapter", async () => {
    vi.mocked(api.chat).mockResolvedValue(reply({ mode: "world_extraction" }));
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");

    fireEvent.click(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    );

    await vi.waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.chat).mock.calls[0][3]).toEqual(["c1"]);
    expect(vi.mocked(api.chat).mock.calls[0][4]).toMatchObject({
      runBatches: true,
      mode: "world_extraction",
    });
  });
});
