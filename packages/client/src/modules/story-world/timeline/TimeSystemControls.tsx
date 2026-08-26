import { Plus, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ListboxSelect,
  Popover,
  ScrollArea,
  Select,
  TextField,
  ToolbarButton,
} from "../../../design";
import type { Translate, UiLocale } from "../../../i18n";
import type { TimeSystem, TimeSystemKind } from "../model";
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
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const settingsPanelId = useId();

  useEffect(() => {
    if (!settingsOpen) return;
    const frame = requestAnimationFrame(() => settingsPanel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [settingsOpen]);

  return (
    <div className="timeline-time-controls">
      <ListboxSelect
        className="timeline-time-system-select"
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
      <div className="timeline-time-settings">
        <ToolbarButton
          ref={settingsButton}
          className="timeline-time-settings-trigger"
          label={t("timelineConfigureTime")}
          icon={<Settings2 />}
          size="regular"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? settingsPanelId : undefined}
          onClick={() => setSettingsOpen((current) => !current)}
        />
        <Popover
          anchorRef={settingsButton}
          open={settingsOpen}
          label={t("timelineConfigureTime")}
          onClose={() => setSettingsOpen(false)}
        >
          <ScrollArea
            ref={settingsPanel}
            id={settingsPanelId}
            tabIndex={-1}
            data-autofocus
            axis="y"
            gutter="stable"
            overscroll="auto"
            scrollbar="thin"
            surface="panel"
            className="timeline-time-settings-panel"
          >
            {system.kind === "custom" && (
              <TextField
                fieldClassName="timeline-time-setting-field"
                label={t("timelineCalendarName")}
                value={system.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            )}
            {system.kind === "relative" ? (
              <Select
                fieldClassName="timeline-time-setting-field"
                label={t("timelineUnit")}
                value={system.unit}
                onChange={(event) => onPatch({ unit: event.target.value as TimeSystem["unit"] })}
              >
                <option value="day">{t("timelineDays")}</option>
                <option value="abstract">{t("timelineAbstract")}</option>
              </Select>
            ) : (
              <>
                <CalendarAnchorFields system={system} onPatch={onPatch} locale={locale} t={t} />
                <TextField
                  fieldClassName="timeline-time-setting-field"
                  label={t("timelineEra")}
                  value={system.eraName}
                  onChange={(event) => onPatch({ eraName: event.target.value })}
                />
                <TextField
                  fieldClassName="timeline-time-setting-field"
                  label={t("timelineEraAbbreviation")}
                  value={system.eraAbbreviation}
                  onChange={(event) => onPatch({ eraAbbreviation: event.target.value })}
                />
                <Select
                  fieldClassName="timeline-time-setting-field"
                  label={t("timelineDisplayFormat")}
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
                </Select>
              </>
            )}
            {system.kind === "custom" && (
              <CustomCalendarSettings system={system} onPatch={onPatch} t={t} />
            )}
          </ScrollArea>
        </Popover>
      </div>
      <ToolbarButton
        label={t("timelineAddCustomCalendar")}
        icon={<Plus />}
        appearance="primary"
        size="regular"
        className="timeline-add-calendar"
        onClick={() => {
          if (system.kind !== "custom") onKindChange("custom");
          setSettingsOpen(true);
        }}
      />
    </div>
  );
}
