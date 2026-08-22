import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import type { TimeSystem, TimeSystemKind } from "../model";
import type { Translate, UiLocale } from "../../../i18n";
import { SelectControl } from "../../../shared/ui/SelectControl";
import { CalendarAnchorFields } from "./CalendarAnchorFields";
import { CustomCalendarSettings } from "./CustomCalendarSettings";
import { defaultDisplayFormat } from "./timelinePresentation";
import "./TimeSystemControls.css";

export function TimeSystemControls({
  system,
  onKindChange,
  onPatch,
  locale,
  t,
}: {
  system: TimeSystem;
  onKindChange: (value: TimeSystemKind) => void;
  onPatch: (patch: Partial<TimeSystem>) => void;
  locale: UiLocale;
  t: Translate;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="timeline-time-controls">
      <SelectControl
        label={t("timelineTimeSystem")}
        value={system.kind}
        options={[
          { value: "relative", label: t("timelineTimeRelative") },
          { value: "gregorian", label: t("timelineTimeGregorian") },
          ...(system.kind === "custom"
            ? [{ value: "custom" as const, label: system.name || t("timelineTimeCustom") }]
            : []),
        ]}
        onChange={onKindChange}
      />
      <details
        className="timeline-time-settings"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary aria-expanded={settingsOpen}>
          <Settings2 aria-hidden="true" />
          <span>{t("timelineConfigureTime")}</span>
        </summary>
        <div className="timeline-time-settings-panel">
          {system.kind === "custom" && (
            <label>
              <span>{t("timelineCalendarName")}</span>
              <input
                value={system.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
          )}
          {system.kind === "relative" ? (
            <label>
              <span>{t("timelineUnit")}</span>
              <select
                value={system.unit}
                onChange={(event) => onPatch({ unit: event.target.value as TimeSystem["unit"] })}
              >
                <option value="day">{t("timelineDays")}</option>
                <option value="abstract">{t("timelineAbstract")}</option>
              </select>
            </label>
          ) : (
            <>
              <CalendarAnchorFields system={system} onPatch={onPatch} locale={locale} t={t} />
              <label>
                <span>{t("timelineEra")}</span>
                <input
                  value={system.eraName}
                  onChange={(event) => onPatch({ eraName: event.target.value })}
                />
              </label>
              <label>
                <span>{t("timelineEraAbbreviation")}</span>
                <input
                  value={system.eraAbbreviation}
                  onChange={(event) => onPatch({ eraAbbreviation: event.target.value })}
                />
              </label>
              <label>
                <span>{t("timelineDisplayFormat")}</span>
                <select
                  value={system.displayFormat || defaultDisplayFormat(system.kind)}
                  onChange={(event) => onPatch({ displayFormat: event.target.value })}
                >
                  <option
                    value={
                      system.kind === "custom"
                        ? "{day} {monthName}, {year} {era}"
                        : "{day:02d}.{month:02d}.{year:04d} {era}"
                    }
                  >
                    {t("timelineFormatDayMonthYear")}
                  </option>
                  <option
                    value={
                      system.kind === "custom"
                        ? "{monthName} {day}, {year} {era}"
                        : "{month:02d}/{day:02d}/{year:04d} {era}"
                    }
                  >
                    {t("timelineFormatMonthDayYear")}
                  </option>
                  <option
                    value={
                      system.kind === "custom"
                        ? "{year} {monthName} {day} {era}"
                        : "{year:04d}-{month:02d}-{day:02d} {era}"
                    }
                  >
                    {t("timelineFormatYearMonthDay")}
                  </option>
                </select>
              </label>
            </>
          )}
          {system.kind === "custom" && (
            <CustomCalendarSettings system={system} onPatch={onPatch} t={t} />
          )}
        </div>
      </details>
      <button
        type="button"
        className="primary timeline-add-calendar"
        onClick={() => {
          if (system.kind !== "custom") onKindChange("custom");
          setSettingsOpen(true);
        }}
      >
        <Plus />
        {t("timelineAddCustomCalendar")}
      </button>
    </div>
  );
}
