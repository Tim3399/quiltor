import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Disclosure,
  IconButton,
  Select,
  SidePanelBody,
  SidePanelHeader,
  TextField,
} from "../../design";
import { useI18n } from "../../i18n";
import {
  BOOK_LAYOUT_PRESETS,
  type BookLayoutPresetId,
  type BookLayoutSettings,
  bookLayoutMatchesPreset,
} from "./bookLayout";
import "./BookLayoutInspector.css";

interface BookLayoutInspectorProps {
  settings: BookLayoutSettings;
  onChange: (settings: BookLayoutSettings) => void;
  onClose: () => void;
}

const metadataFields = [
  "bookTitle",
  "subtitle",
  "author",
  "series",
  "volume",
  "showNovelLabel",
  "showVersion",
  "showDate",
] as const;

const pageFormats = {
  "6x9": [152.4, 228.6],
  a5: [148, 210],
  "5.5x8.5": [139.7, 215.9],
} as const;

export function BookLayoutInspector({ settings, onChange, onClose }: BookLayoutInspectorProps) {
  const { t } = useI18n();
  const matchedPreset = (Object.keys(BOOK_LAYOUT_PRESETS) as BookLayoutPresetId[]).find((id) =>
    bookLayoutMatchesPreset(settings, id),
  );
  const patch = (next: Partial<BookLayoutSettings>) => {
    const candidate = { ...settings, ...next };
    if (
      candidate.pageWidthMm -
        candidate.marginInnerMm -
        candidate.marginOuterMm -
        candidate.gutterMm <
        30 ||
      candidate.pageHeightMm - candidate.marginTopMm - candidate.marginBottomMm < 30
    )
      return;
    onChange(candidate);
  };
  const applyPreset = (preset: BookLayoutPresetId) => {
    const metadata = Object.fromEntries(metadataFields.map((key) => [key, settings[key]]));
    onChange({ ...BOOK_LAYOUT_PRESETS[preset], ...metadata });
  };

  return (
    <>
      <SidePanelHeader
        className="book-layout-inspector__header"
        title={t("bookLayout")}
        actions={
          <IconButton
            label={t("closeInspector")}
            icon={<X />}
            onClick={onClose}
            title={t("closeInspector")}
          />
        }
      />
      <SidePanelBody className="book-layout-inspector">
        <section className="book-layout-inspector__preset" aria-label={t("layoutPreset")}>
          <Select
            label={t("layoutPreset")}
            value={matchedPreset ?? settings.preset}
            onChange={(event) => applyPreset(event.target.value as BookLayoutPresetId)}
          >
            <option value="quiltor-novel">{t("presetQuiltorNovel")}</option>
            <option value="classic-paperback">{t("presetClassicPaperback")}</option>
            <option value="a5-manuscript">{t("presetA5Manuscript")}</option>
          </Select>
          <Button
            className="book-layout-inspector__reset"
            size="compact"
            appearance="ghost"
            icon={<RotateCcw />}
            onClick={() => applyPreset(settings.preset)}
          >
            {t("resetLayoutPreset")}
          </Button>
        </section>

        <Disclosure summary={t("bookMetadata")} open>
          <TextSetting
            label={t("bookTitle")}
            value={settings.bookTitle}
            maxLength={1000}
            onChange={(bookTitle) => patch({ bookTitle })}
          />
          <TextSetting
            label={t("bookSubtitle")}
            value={settings.subtitle}
            maxLength={1000}
            onChange={(subtitle) => patch({ subtitle })}
          />
          <TextSetting
            label={t("bookAuthor")}
            value={settings.author}
            maxLength={1000}
            onChange={(author) => patch({ author })}
          />
          <TextSetting
            label={t("bookSeries")}
            value={settings.series}
            maxLength={1000}
            onChange={(series) => patch({ series })}
          />
          <TextSetting
            label={t("bookVolume")}
            value={settings.volume}
            maxLength={1000}
            onChange={(volume) => patch({ volume })}
          />
          <Toggle
            label={t("showNovelLabel")}
            checked={settings.showNovelLabel}
            onChange={(showNovelLabel) => patch({ showNovelLabel })}
          />
          <Toggle
            label={t("showVersion")}
            checked={settings.showVersion}
            onChange={(showVersion) => patch({ showVersion })}
          />
          <Toggle
            label={t("showDate")}
            checked={settings.showDate}
            onChange={(showDate) => patch({ showDate })}
          />
        </Disclosure>

        <Disclosure summary={t("pageSetup")} open>
          <Select
            label={t("pageFormat")}
            value={settings.pageFormat}
            onChange={(event) => {
              const pageFormat = event.target.value as BookLayoutSettings["pageFormat"];
              const dimensions = pageFormat === "custom" ? null : pageFormats[pageFormat];
              patch({
                pageFormat,
                ...(dimensions ? { pageWidthMm: dimensions[0], pageHeightMm: dimensions[1] } : {}),
              });
            }}
          >
            <option value="6x9">6 × 9″</option>
            <option value="5.5x8.5">5,5 × 8,5″</option>
            <option value="a5">{t("pageFormatA5")}</option>
            <option value="custom">{t("customPageFormat")}</option>
          </Select>
          <NumberSetting
            label={t("pageWidthMm")}
            value={settings.pageWidthMm}
            min={settings.marginInnerMm + settings.marginOuterMm + settings.gutterMm + 30}
            max={400}
            disabled={settings.pageFormat !== "custom"}
            onChange={(pageWidthMm) => patch({ pageWidthMm })}
          />
          <NumberSetting
            label={t("pageHeightMm")}
            value={settings.pageHeightMm}
            min={settings.marginTopMm + settings.marginBottomMm + 30}
            max={500}
            disabled={settings.pageFormat !== "custom"}
            onChange={(pageHeightMm) => patch({ pageHeightMm })}
          />
          <NumberSetting
            label={t("marginInnerMm")}
            value={settings.marginInnerMm}
            min={0}
            max={settings.pageWidthMm - settings.marginOuterMm - settings.gutterMm - 30}
            onChange={(marginInnerMm) => patch({ marginInnerMm })}
          />
          <NumberSetting
            label={t("marginOuterMm")}
            value={settings.marginOuterMm}
            min={0}
            max={settings.pageWidthMm - settings.marginInnerMm - settings.gutterMm - 30}
            onChange={(marginOuterMm) => patch({ marginOuterMm })}
          />
          <NumberSetting
            label={t("marginTopMm")}
            value={settings.marginTopMm}
            min={0}
            max={settings.pageHeightMm - settings.marginBottomMm - 30}
            onChange={(marginTopMm) => patch({ marginTopMm })}
          />
          <NumberSetting
            label={t("marginBottomMm")}
            value={settings.marginBottomMm}
            min={0}
            max={settings.pageHeightMm - settings.marginTopMm - 30}
            onChange={(marginBottomMm) => patch({ marginBottomMm })}
          />
          <NumberSetting
            label={t("gutterMm")}
            value={settings.gutterMm}
            min={0}
            max={settings.pageWidthMm - settings.marginInnerMm - settings.marginOuterMm - 30}
            onChange={(gutterMm) => patch({ gutterMm })}
          />
          <Toggle
            label={t("mirrorMargins")}
            checked={settings.mirrorMargins}
            onChange={(mirrorMargins) => patch({ mirrorMargins })}
          />
        </Disclosure>

        <Disclosure summary={t("bodyTypography")} open>
          <Select
            label={t("fontFamily")}
            value={settings.fontFamily}
            onChange={(event) =>
              patch({ fontFamily: event.target.value as BookLayoutSettings["fontFamily"] })
            }
          >
            <option value="eb-garamond">{t("fontEbGaramond")}</option>
            <option value="literata">{t("fontLiterata")}</option>
            <option value="source-serif-4">{t("fontSourceSerif4")}</option>
            <option value="crimson-pro">{t("fontCrimsonPro")}</option>
            <option value="libre-baskerville">{t("fontLibreBaskerville")}</option>
          </Select>
          <NumberSetting
            label={t("fontSizePt")}
            value={settings.fontSizePt}
            min={6}
            max={30}
            step={0.25}
            onChange={(fontSizePt) => patch({ fontSizePt })}
          />
          <NumberSetting
            label={t("lineHeight")}
            value={settings.lineHeight}
            min={1}
            max={3}
            step={0.05}
            onChange={(lineHeight) => patch({ lineHeight })}
          />
          <Select
            label={t("textAlignment")}
            value={settings.alignment}
            onChange={(event) =>
              patch({ alignment: event.target.value as BookLayoutSettings["alignment"] })
            }
          >
            <option value="justify">{t("alignmentJustify")}</option>
            <option value="left">{t("alignmentLeft")}</option>
          </Select>
          <Toggle
            label={t("hyphenation")}
            checked={settings.hyphenation}
            onChange={(hyphenation) => patch({ hyphenation })}
          />
          <Toggle
            label={t("firstLineIndent")}
            checked={settings.firstLineIndent}
            onChange={(firstLineIndent) => patch({ firstLineIndent })}
          />
          <NumberSetting
            label={t("firstLineIndentEm")}
            value={settings.firstLineIndentEm}
            min={0}
            max={5}
            step={0.05}
            disabled={!settings.firstLineIndent}
            onChange={(firstLineIndentEm) => patch({ firstLineIndentEm })}
          />
          <NumberSetting
            label={t("paragraphSpacingEm")}
            value={settings.paragraphSpacingEm}
            min={0}
            max={5}
            step={0.05}
            onChange={(paragraphSpacingEm) => patch({ paragraphSpacingEm })}
          />
          <NumberSetting
            label={t("widows")}
            value={settings.widows}
            min={1}
            max={10}
            step={1}
            onChange={(widows) => patch({ widows })}
          />
          <NumberSetting
            label={t("orphans")}
            value={settings.orphans}
            min={1}
            max={10}
            step={1}
            onChange={(orphans) => patch({ orphans })}
          />
        </Disclosure>

        <Disclosure summary={t("chapterLayout")}>
          <Select
            label={t("chapterStart")}
            value={settings.chapterStart}
            onChange={(event) =>
              patch({ chapterStart: event.target.value as BookLayoutSettings["chapterStart"] })
            }
          >
            <option value="next-page">{t("chapterStartNextPage")}</option>
            <option value="right-page">{t("chapterStartRightPage")}</option>
          </Select>
          <NumberSetting
            label={t("chapterTopMm")}
            value={settings.chapterTopMm}
            min={0}
            max={100}
            onChange={(chapterTopMm) => patch({ chapterTopMm })}
          />
          <Toggle
            label={t("showChapterNumber")}
            checked={settings.chapterNumber}
            onChange={(chapterNumber) => patch({ chapterNumber })}
          />
          <Select
            label={t("chapterNumberStyle")}
            value={settings.chapterNumberStyle}
            disabled={!settings.chapterNumber}
            onChange={(event) =>
              patch({
                chapterNumberStyle: event.target.value as BookLayoutSettings["chapterNumberStyle"],
              })
            }
          >
            <option value="number">1</option>
            <option value="padded">01</option>
            <option value="chapter">{t("chapterWordNumber")}</option>
          </Select>
          <Toggle
            label={t("showChapterTitle")}
            checked={settings.chapterTitle}
            onChange={(chapterTitle) => patch({ chapterTitle })}
          />
          <Select
            label={t("chapterAlignment")}
            value={settings.chapterAlignment}
            onChange={(event) =>
              patch({
                chapterAlignment: event.target.value as BookLayoutSettings["chapterAlignment"],
              })
            }
          >
            <option value="left">{t("alignmentLeft")}</option>
            <option value="center">{t("alignmentCenter")}</option>
          </Select>
          <NumberSetting
            label={t("chapterTitleSizePt")}
            value={settings.chapterTitleSizePt}
            min={8}
            max={48}
            step={0.25}
            onChange={(chapterTitleSizePt) => patch({ chapterTitleSizePt })}
          />
          <Toggle
            label={t("dropCap")}
            checked={settings.dropCap}
            onChange={(dropCap) => patch({ dropCap })}
          />
          <Toggle
            label={t("chapterFirstIndent")}
            checked={settings.chapterFirstIndent}
            onChange={(chapterFirstIndent) => patch({ chapterFirstIndent })}
          />
        </Disclosure>

        <Disclosure summary={t("sceneBreaks")}>
          <TextSetting
            label={t("sceneSymbol")}
            value={settings.sceneSymbol}
            maxLength={32}
            onChange={(sceneSymbol) =>
              patch({ sceneSymbol: sceneSymbol.trim() ? sceneSymbol : "" })
            }
          />
          <NumberSetting
            label={t("sceneSpaceBeforeMm")}
            value={settings.sceneSpaceBeforeMm}
            min={0}
            max={80}
            onChange={(sceneSpaceBeforeMm) => patch({ sceneSpaceBeforeMm })}
          />
          <NumberSetting
            label={t("sceneSpaceAfterMm")}
            value={settings.sceneSpaceAfterMm}
            min={0}
            max={80}
            onChange={(sceneSpaceAfterMm) => patch({ sceneSpaceAfterMm })}
          />
        </Disclosure>

        <Disclosure summary={t("pageNumbering")}>
          <Toggle
            label={t("showPageNumbers")}
            checked={settings.pageNumbers}
            onChange={(pageNumbers) => patch({ pageNumbers })}
          />
          <Select
            label={t("pageNumberPosition")}
            value={settings.pageNumberPosition}
            disabled={!settings.pageNumbers}
            onChange={(event) =>
              patch({
                pageNumberPosition: event.target.value as BookLayoutSettings["pageNumberPosition"],
              })
            }
          >
            <option value="bottom-center">{t("pageNumberBottomCenter")}</option>
            <option value="bottom-outside">{t("pageNumberBottomOutside")}</option>
            <option value="top-outside">{t("pageNumberTopOutside")}</option>
          </Select>
          <Toggle
            label={t("hideChapterPageNumbers")}
            checked={settings.hideChapterPageNumbers}
            onChange={(hideChapterPageNumbers) => patch({ hideChapterPageNumbers })}
          />
          <Toggle
            label={t("hideTitlePageNumber")}
            checked={settings.hideTitlePageNumber}
            onChange={(hideTitlePageNumber) => patch({ hideTitlePageNumber })}
          />
          <Toggle
            label={t("numberFromFirstChapter")}
            checked={settings.numberFromFirstChapter}
            onChange={(numberFromFirstChapter) => patch({ numberFromFirstChapter })}
          />
        </Disclosure>
      </SidePanelBody>
    </>
  );
}

function TextSetting({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Checkbox
      containerClassName="book-layout-inspector__toggle"
      label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function NumberSetting({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const previousValue = useRef(value);
  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    setDraft(String(value));
  }, [value]);
  return (
    <TextField
      label={label}
      type="number"
      inputMode="decimal"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      error={
        draft !== "" &&
        (!Number.isFinite(Number(draft)) ||
          Number(draft) < min ||
          Number(draft) > max ||
          (step === 1 && !Number.isInteger(Number(draft))))
          ? tNumberRange(min, max)
          : undefined
      }
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const next = Number(nextDraft);
        if (
          nextDraft !== "" &&
          Number.isFinite(next) &&
          next >= min &&
          next <= max &&
          (step !== 1 || Number.isInteger(next))
        )
          onChange(next);
      }}
    />
  );
}

function tNumberRange(min: number, max: number) {
  return `${min}–${max}`;
}
