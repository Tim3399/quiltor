import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureState } from "../model";
import { PresenceField } from "./PresenceField";

afterEach(cleanup);

describe("PresenceField", () => {
  it("persists the selected initial place through the world state callback", () => {
    const person = { id: "ada", x: 0, y: 0, name: "Ada", type: "person" as const };
    const state: FigureState = {
      nodes: [person, { id: "city", x: 300, y: 0, name: "Stadt", type: "ort" }],
      edges: [],
    };
    const onState = vi.fn();
    const view = render(
      <I18nProvider>
        <PresenceField
          figure={person}
          state={state}
          activeMomentId={null}
          onState={onState}
          onSelectMoment={vi.fn()}
        />
      </I18nProvider>,
    );

    const place = screen.getByRole("combobox", { name: "Ort (Ausgangslage)" });
    expect(place.tagName).toBe("BUTTON");
    expect(place).toHaveClass("ui-select-control");
    expect(view.container.querySelector("select")).toBeNull();
    fireEvent.click(place);
    fireEvent.click(screen.getByRole("option", { name: "Stadt" }));

    expect(onState).toHaveBeenCalledWith({
      ...state,
      presence: [{ id: expect.any(String), elementId: "ada", placeId: "city" }],
    });
  });
});
