import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { TimeSystem } from "../model";
import type { Translate } from "../../../i18n";
import "./CustomCalendarSettings.css";

export function CustomCalendarSettings({
  system,
  onPatch,
  t,
}: {
  system: TimeSystem;
  onPatch: (patch: Partial<TimeSystem>) => void;
  t: Translate;
}) {
  const [monthCount, setMonthCount] = useState(1);
  const [weekdayCount, setWeekdayCount] = useState(1);
  const patchMonth = (index: number, patch: Partial<TimeSystem["months"][number]>) =>
    onPatch({
      months: system.months.map((month, position) =>
        position === index ? { ...month, ...patch } : month,
      ),
    });
  const addMonths = () => {
    const count = Math.min(100, Math.max(1, Math.trunc(monthCount) || 1));
    onPatch({
      months: [
        ...system.months,
        ...Array.from({ length: count }, (_, offset) => {
          const number = system.months.length + offset + 1;
          return {
            name: t("timelineMonthDefault", { number }),
            shortName: `M${number}`,
            dayCount: 30,
          };
        }),
      ],
    });
  };
  const addWeekdays = () => {
    const count = Math.min(100, Math.max(1, Math.trunc(weekdayCount) || 1));
    onPatch({
      weekdays: [
        ...system.weekdays,
        ...Array.from({ length: count }, (_, offset) => {
          const number = system.weekdays.length + offset + 1;
          return {
            name: t("timelineWeekdayDefault", { number }),
            shortName: t("timelineWeekdayShortDefault", { number }),
          };
        }),
      ],
    });
  };

  return (
    <div className="timeline-calendar-structure">
      <fieldset>
        <legend>{t("timelineWeekdays")}</legend>
        {!!system.weekdays.length && (
          <div className="timeline-calendar-item-head" aria-hidden="true">
            <span>{t("name")}</span>
            <span>{t("timelineAbbreviation")}</span>
            <span />
          </div>
        )}
        {system.weekdays.map((weekday, index) => (
          <div className="timeline-calendar-item" key={`weekday-${index}`}>
            <input
              aria-label={t("timelineWeekdayName", { number: index + 1 })}
              value={weekday.name}
              onChange={(event) =>
                onPatch({
                  weekdays: system.weekdays.map((item, position) =>
                    position === index ? { ...item, name: event.target.value } : item,
                  ),
                })
              }
            />
            <input
              aria-label={t("timelineWeekdayShortName", { name: weekday.name })}
              value={weekday.shortName}
              onChange={(event) =>
                onPatch({
                  weekdays: system.weekdays.map((item, position) =>
                    position === index ? { ...item, shortName: event.target.value } : item,
                  ),
                })
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={t("timelineRemoveWeekday", { name: weekday.name })}
              onClick={() =>
                onPatch({
                  weekdays: system.weekdays.filter((_, position) => position !== index),
                  epochWeekday: Math.min(
                    system.epochWeekday,
                    Math.max(system.weekdays.length - 2, 0),
                  ),
                })
              }
            >
              <X />
            </button>
          </div>
        ))}
        <div className="timeline-calendar-add-row">
          <input
            type="number"
            min="1"
            max="100"
            aria-label={t("timelineWeekdayCount")}
            value={weekdayCount}
            onChange={(event) => setWeekdayCount(Number(event.target.value))}
          />
          <button type="button" onClick={addWeekdays}>
            <Plus />
            {t("timelineAddWeekdays")}
          </button>
        </div>
      </fieldset>
      {!!system.weekdays.length && (
        <label>
          <span>{t("timelineEpochWeekday")}</span>
          <select
            value={system.epochWeekday}
            onChange={(event) => onPatch({ epochWeekday: Number(event.target.value) })}
          >
            {system.weekdays.map((weekday, index) => (
              <option key={`${weekday.name}-${index}`} value={index}>
                {weekday.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset>
        <legend>{t("timelineMonths")}</legend>
        <div className="timeline-calendar-item-head" aria-hidden="true">
          <span>{t("name")}</span>
          <span>{t("timelineDays")}</span>
          <span />
        </div>
        {system.months.map((month, index) => (
          <div className="timeline-calendar-item" key={`month-${index}`}>
            <input
              aria-label={t("timelineMonthName", { number: index + 1 })}
              value={month.name}
              onChange={(event) => patchMonth(index, { name: event.target.value })}
            />
            <input
              aria-label={t("timelineMonthDays", { name: month.name })}
              type="number"
              min="1"
              step="1"
              value={month.dayCount}
              onChange={(event) =>
                patchMonth(index, {
                  dayCount: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                })
              }
            />
            <button
              type="button"
              className="icon-button"
              disabled={system.months.length === 1}
              aria-label={t("timelineRemoveMonth", { name: month.name })}
              onClick={() =>
                onPatch({
                  months: system.months.filter((_, position) => position !== index),
                  epochMonth: Math.min(system.epochMonth, system.months.length - 1),
                })
              }
            >
              <X />
            </button>
          </div>
        ))}
        <div className="timeline-calendar-add-row">
          <input
            type="number"
            min="1"
            max="100"
            aria-label={t("timelineMonthCount")}
            value={monthCount}
            onChange={(event) => setMonthCount(Number(event.target.value))}
          />
          <button type="button" onClick={addMonths}>
            <Plus />
            {t("timelineAddMonths")}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
