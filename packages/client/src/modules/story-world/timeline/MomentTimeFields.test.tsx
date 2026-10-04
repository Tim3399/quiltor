import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import type { TimelineMoment, TimeSystem } from "../model";
import { MomentCalendarFields, RelativeMomentFields } from "./MomentTimeFields";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(cleanup);

function GregorianFields({
  onStartChange,
  onEndChange = vi.fn(),
  onClearEnd = vi.fn(),
  endTime,
}: {
  onStartChange: (time: number, precision: "day" | "month" | "year") => void;
  onEndChange?: (time: number, precision: "day" | "month" | "year") => void;
  onClearEnd?: () => void;
  endTime?: number;
}) {
  const { locale, t } = useI18n();
  const system: TimeSystem = {
    ...DEFAULT_TIME_SYSTEM,
    kind: "gregorian",
    epochYear: 2024,
  };
  return (
    <MomentCalendarFields
      system={system}
      moment={{ id: "m1", title: "Ankunft", time: 0, endTime, position: 0 }}
      fallback={0}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
      onClearEnd={onClearEnd}
      locale={locale}
      t={t}
    />
  );
}

describe("MomentTimeFields", () => {
  it("keeps the visible calendar coordinate in day-month-year order and derives precision", () => {
    const onStartChange = vi.fn();
    render(
      <I18nProvider>
        <GregorianFields onStartChange={onStartChange} />
      </I18nProvider>,
    );
    const date = screen.getByRole("group", { name: "Datum" });
    expect(
      [...date.querySelectorAll(":scope > .calendar-coordinate-field > label")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Tag", "Monat", "Jahr"]);
    fireEvent.change(within(date).getByRole("combobox", { name: "Tag" }), {
      target: { value: "" },
    });
    expect(onStartChange).toHaveBeenCalledWith(0, "month");
  });

  it("edits a relative moment from a separate base without coupling simultaneous moments", () => {
    const onChange = vi.fn();
    const timeline: TimelineMoment[] = [
      { id: "base", title: "Basis", time: 0, position: 0 },
      { id: "selected", title: "Auswahl", time: 0, position: 1 },
    ];
    function RelativeFields() {
      const { t } = useI18n();
      return (
        <RelativeMomentFields
          system={DEFAULT_TIME_SYSTEM}
          timeline={timeline}
          selected={timeline[1]}
          amount={0}
          direction="after"
          baseId="base"
          onChange={onChange}
          t={t}
        />
      );
    }
    render(
      <I18nProvider>
        <RelativeFields />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Abstand in Tagen" }), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith(2, "after", "base");
    expect(timeline.map((moment) => moment.time)).toEqual([0, 0]);
  });

  it("adds and removes the optional end through the shared actions", () => {
    const onEndChange = vi.fn();
    const onClearEnd = vi.fn();
    const view = render(
      <I18nProvider>
        <GregorianFields
          onStartChange={vi.fn()}
          onEndChange={onEndChange}
          onClearEnd={onClearEnd}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ende hinzufügen" }));
    expect(onEndChange).toHaveBeenCalledWith(0, "day");

    view.rerender(
      <I18nProvider>
        <GregorianFields
          endTime={0}
          onStartChange={vi.fn()}
          onEndChange={onEndChange}
          onClearEnd={onClearEnd}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ende entfernen" }));
    expect(onClearEnd).toHaveBeenCalledOnce();
  });
});
