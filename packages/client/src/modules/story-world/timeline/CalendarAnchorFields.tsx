import type { Translate, UiLocale } from "../../../i18n";
import type { TimeSystem } from "../model";
import { CalendarCoordinateFields } from "./CalendarCoordinateFields";
import type { CalendarCoordinate } from "./timeSystem";

export function CalendarAnchorFields({
  system,
  onPatch,
  locale,
  t,
}: {
  system: TimeSystem;
  onPatch: (patch: Partial<TimeSystem>) => void;
  locale: UiLocale;
  t: Translate;
}) {
  const patchDate = (next: CalendarCoordinate) => {
    onPatch({ epochYear: next.year, epochMonth: next.month, epochDay: next.day });
  };
  return (
    <CalendarCoordinateFields
      system={system}
      coordinate={{ year: system.epochYear, month: system.epochMonth, day: system.epochDay }}
      label={t("timelineAnchorDate")}
      locale={locale}
      t={t}
      className="timeline-anchor-date"
      onChange={patchDate}
    />
  );
}
