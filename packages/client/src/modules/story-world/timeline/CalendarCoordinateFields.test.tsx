import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../i18n";
import {
  CalendarCoordinateFields,
  type CalendarCoordinateFieldsProps,
} from "./CalendarCoordinateFields";
import { DEFAULT_TIME_SYSTEM } from "./timeSystem";

afterEach(cleanup);

function Fixture({ onChange }: { onChange: CalendarCoordinateFieldsProps["onChange"] }) {
  const { locale, t } = useI18n();
  return (
    <CalendarCoordinateFields
      system={{ ...DEFAULT_TIME_SYSTEM, kind: "gregorian", name: "Gregorian" }}
      coordinate={{ year: 2024, month: 2, day: 29 }}
      precision="day"
      allowUnknown
      label="Date"
      locale={locale}
      t={t}
      onChange={onChange}
    />
  );
}

describe("CalendarCoordinateFields", () => {
  it("derives precision from unknown fields and keeps coordinates valid", () => {
    const onChange = vi.fn<CalendarCoordinateFieldsProps["onChange"]>();
    render(
      <I18nProvider>
        <Fixture onChange={onChange} />
      </I18nProvider>,
    );
    const group = screen.getByRole("group", { name: "Date" });

    fireEvent.change(within(group).getByRole("combobox", { name: "Tag" }), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ year: 2024, month: 2, day: 1 }, "month");

    fireEvent.change(within(group).getByRole("combobox", { name: "Monat" }), {
      target: { value: "4" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ year: 2024, month: 4, day: 1 }, "month");
  });
});
