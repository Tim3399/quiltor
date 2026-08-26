import { useState } from "react";
import { Select } from "../../../design";
import type { Translate } from "../../../i18n";
import type { TimeSystem } from "../model";
import { CalendarDefinitionList } from "./CalendarDefinitionList";
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
      <CalendarDefinitionList
        legend={t("timelineWeekdays")}
        items={system.weekdays}
        itemKey={(_weekday, index) => `weekday-${index}`}
        columns={[
          {
            heading: t("name"),
            field: (weekday, index) => ({
              label: t("timelineWeekdayName", { number: index + 1 }),
              labelHidden: true,
              value: weekday.name,
              onChange: (event) =>
                onPatch({
                  weekdays: system.weekdays.map((item, position) =>
                    position === index ? { ...item, name: event.target.value } : item,
                  ),
                }),
            }),
          },
          {
            heading: t("timelineAbbreviation"),
            field: (weekday, index) => ({
              label: t("timelineWeekdayShortName", { name: weekday.name }),
              labelHidden: true,
              value: weekday.shortName,
              onChange: (event) =>
                onPatch({
                  weekdays: system.weekdays.map((item, position) =>
                    position === index ? { ...item, shortName: event.target.value } : item,
                  ),
                }),
            }),
          },
        ]}
        count={weekdayCount}
        countLabel={t("timelineWeekdayCount")}
        addLabel={t("timelineAddWeekdays")}
        removeLabel={(weekday) => t("timelineRemoveWeekday", { name: weekday.name })}
        onCountChange={setWeekdayCount}
        onAdd={addWeekdays}
        onRemove={(index) =>
          onPatch({
            weekdays: system.weekdays.filter((_, position) => position !== index),
            epochWeekday: Math.min(system.epochWeekday, Math.max(system.weekdays.length - 2, 0)),
          })
        }
      />
      {!!system.weekdays.length && (
        <Select
          fieldClassName="timeline-epoch-weekday"
          label={t("timelineEpochWeekday")}
          value={system.epochWeekday}
          onChange={(event) => onPatch({ epochWeekday: Number(event.target.value) })}
        >
          {system.weekdays.map((weekday, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Custom weekdays have no stored id; their ordered index is their persisted identity.
            <option key={`${weekday.name}-${index}`} value={index}>
              {weekday.name}
            </option>
          ))}
        </Select>
      )}
      <CalendarDefinitionList
        legend={t("timelineMonths")}
        items={system.months}
        itemKey={(_month, index) => `month-${index}`}
        columns={[
          {
            heading: t("name"),
            field: (month, index) => ({
              label: t("timelineMonthName", { number: index + 1 }),
              labelHidden: true,
              value: month.name,
              onChange: (event) => patchMonth(index, { name: event.target.value }),
            }),
          },
          {
            heading: t("timelineDays"),
            field: (month, index) => ({
              label: t("timelineMonthDays", { name: month.name }),
              labelHidden: true,
              type: "number",
              min: 1,
              step: 1,
              value: month.dayCount,
              onChange: (event) =>
                patchMonth(index, {
                  dayCount: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                }),
            }),
          },
        ]}
        count={monthCount}
        countLabel={t("timelineMonthCount")}
        addLabel={t("timelineAddMonths")}
        removeLabel={(month) => t("timelineRemoveMonth", { name: month.name })}
        canRemove={() => system.months.length > 1}
        onCountChange={setMonthCount}
        onAdd={addMonths}
        onRemove={(index) =>
          onPatch({
            months: system.months.filter((_, position) => position !== index),
            epochMonth: Math.min(system.epochMonth, system.months.length - 1),
          })
        }
      />
    </div>
  );
}
