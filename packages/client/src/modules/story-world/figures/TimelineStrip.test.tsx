import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { TimelineStrip } from "./TimelineStrip";

afterEach(cleanup);

describe("TimelineStrip", () => {
  it("owns timeline selection, playback, and moment creation controls", () => {
    const onPlay = vi.fn();
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    render(
      <I18nProvider>
        <TimelineStrip
          timeline={[{ id: "arrival", title: "Ankunft", date: "1420-03-12" }]}
          activeId={null}
          playing={false}
          onPlay={onPlay}
          onSelect={onSelect}
          onAdd={onAdd}
          onPatch={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zeitreise abspielen" }));
    fireEvent.click(screen.getByRole("button", { name: /Ankunft/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Neuer Zeitpunkt" }), {
      target: { value: "Verrat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zeitpunkt hinzufügen" }));

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("arrival");
    expect(onAdd).toHaveBeenCalledWith("Verrat", undefined);
  });
});
