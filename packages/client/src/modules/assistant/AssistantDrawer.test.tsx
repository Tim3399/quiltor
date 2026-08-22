import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { api, setup } from "./AssistantDrawer.testSupport";

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
});
