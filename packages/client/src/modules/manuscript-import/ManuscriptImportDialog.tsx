import { RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Dialog, Disclosure, ScrollArea, TextField } from "../../design";
import { type MessageKey, useI18n } from "../../i18n";
import {
  applicationErrorMessage,
  MANUSCRIPT_IMPORT_MAX_BYTES,
  type ManuscriptImportPreview,
  type ManuscriptImportSelection,
  type ManuscriptImportSource,
  type ManuscriptImportWarningCode,
  quiltorClient,
} from "../../platform";
import { markedSegments } from "../manuscript";
import type { WorldInfo } from "../story-world";
import "./ManuscriptImportDialog.css";

const warningLabels: Record<ManuscriptImportWarningCode, MessageKey> = {
  images: "manuscriptImportWarningImages",
  hyperlinks: "manuscriptImportWarningHyperlinks",
  headers_footers: "manuscriptImportWarningHeadersFooters",
  footnotes_endnotes: "manuscriptImportWarningFootnotesEndnotes",
  comments: "manuscriptImportWarningComments",
  numbering: "manuscriptImportWarningNumbering",
  fields: "manuscriptImportWarningFields",
  formatting: "manuscriptImportWarningFormatting",
};

const warningHelp: Record<ManuscriptImportWarningCode, MessageKey> = {
  images: "manuscriptImportWarningImagesHelp",
  hyperlinks: "manuscriptImportWarningHyperlinksHelp",
  headers_footers: "manuscriptImportWarningHeadersFootersHelp",
  footnotes_endnotes: "manuscriptImportWarningFootnotesEndnotesHelp",
  comments: "manuscriptImportWarningCommentsHelp",
  numbering: "manuscriptImportWarningNumberingHelp",
  fields: "manuscriptImportWarningFieldsHelp",
  formatting: "manuscriptImportWarningFormattingHelp",
};

function selectionOf(preview: ManuscriptImportPreview): ManuscriptImportSelection {
  return {
    title: preview.title,
    chapters: preview.chapters.map(({ sourceIndexes, title, folderPath }) => ({
      sourceIndexes: [...sourceIndexes],
      title,
      folderPath: [...folderPath],
    })),
  };
}

function validFolderPath(path: string[]): boolean {
  return (
    path.length <= 8 &&
    path.every((component) => Boolean(component.trim() && [...component.trim()].length <= 1000))
  );
}

function normalizeSelection(selection: ManuscriptImportSelection): ManuscriptImportSelection {
  return {
    ...selection,
    chapters: selection.chapters.map((chapter) => ({
      ...chapter,
      sourceIndexes: [...chapter.sourceIndexes],
      folderPath: chapter.folderPath.map((component) => component.trim()),
    })),
  };
}

function folderPathInput(path: string[]): string {
  return path.join("/");
}

function folderPathFromInput(value: string): string[] {
  return value ? value.split("/") : [];
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

function sourceIndexesEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function FormattedText({
  body,
  marks,
}: {
  body: string;
  marks: ManuscriptImportPreview["chapters"][number]["marks"];
}) {
  return (
    <p className="manuscript-import-chapter__body">
      {markedSegments(body, 0, marks).map((segment, index) => {
        let content: React.ReactNode = segment.text;
        if (segment.italic) content = <em>{content}</em>;
        if (segment.bold) content = <strong>{content}</strong>;
        return <span key={`${index}-${segment.text.length}`}>{content}</span>;
      })}
    </p>
  );
}

export function ManuscriptImportDialog({
  onImported,
  onClose,
}: {
  onImported: (world: WorldInfo) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const generation = useRef(0);
  const chapterTitleRefs = useRef(new Map<string, HTMLInputElement>());
  const [source, setSource] = useState<ManuscriptImportSource | null>(null);
  const [preview, setPreview] = useState<ManuscriptImportPreview | null>(null);
  const [selection, setSelection] = useState<ManuscriptImportSelection | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<ManuscriptImportWarningCode>>(new Set());
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [committedWorld, setCommittedWorld] = useState<WorldInfo | null>(null);
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null);
  const [splitChapter, setSplitChapter] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFocusKey) return;
    const titleInput = chapterTitleRefs.current.get(pendingFocusKey);
    if (!titleInput) return;
    titleInput.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey, selection]);

  const requestPreview = async (
    selectedSource: ManuscriptImportSource,
    selectedSelection?: ManuscriptImportSelection,
  ) => {
    const nextGeneration = ++generation.current;
    setError("");
    setReviewed(false);
    setPreviewing(true);
    try {
      const result = await quiltorClient.application.manuscriptImport.preview(
        selectedSource,
        selectedSelection ? normalizeSelection(selectedSelection) : undefined,
      );
      if (generation.current !== nextGeneration) return;
      setPreview(result.preview);
      setSelection(selectionOf(result.preview));
      setAcknowledged(new Set());
      setReviewed(true);
    } catch (reason) {
      if (generation.current === nextGeneration) setError(applicationErrorMessage(reason));
    } finally {
      if (generation.current === nextGeneration) setPreviewing(false);
    }
  };

  const inspect = (file: File) => {
    generation.current += 1;
    const selectedSource = { fileName: file.name, size: file.size, content: file };
    setSource(selectedSource);
    setPreview(null);
    setSelection(null);
    setAcknowledged(new Set());
    setReviewed(false);
    setCommittedWorld(null);
    setExpandedChapter(null);
    setSplitChapter(null);
    setPendingFocusKey(null);
    setRequestId(quiltorClient.application.manuscriptImport.createRequestId());
    setError("");
    if (file.size > MANUSCRIPT_IMPORT_MAX_BYTES) {
      setError(t("manuscriptImportTooLarge"));
      setPreviewing(false);
      return;
    }
    void requestPreview(selectedSource);
  };

  const editSelection = (next: ManuscriptImportSelection) => {
    generation.current += 1;
    setPreviewing(false);
    setSelection(next);
    setReviewed(false);
    setAcknowledged(new Set());
    setRequestId(quiltorClient.application.manuscriptImport.createRequestId());
    setError("");
  };

  const importManuscript = async () => {
    if (importing || (!committedWorld && (!source || !preview || !selection || !reviewed))) return;
    setImporting(true);
    setError("");
    let importCommitted = Boolean(committedWorld);
    try {
      const world = committedWorld
        ? committedWorld
        : (
            await quiltorClient.application.manuscriptImport.importManuscript({
              source: source as ManuscriptImportSource,
              sourceSha256: (preview as ManuscriptImportPreview).sourceSha256,
              title: (selection as ManuscriptImportSelection).title,
              chapters: (selection as ManuscriptImportSelection).chapters,
              acknowledgedWarnings: (preview as ManuscriptImportPreview).warnings
                .map(({ code }) => code)
                .filter((code) => acknowledged.has(code)),
              requestId,
            })
          ).world;
      setCommittedWorld(world);
      importCommitted = true;
      await onImported(world);
      onClose();
    } catch (reason) {
      setError(importCommitted ? t("manuscriptImportOpenFailed") : applicationErrorMessage(reason));
    } finally {
      setImporting(false);
    }
  };

  const selectionValid = Boolean(
    selection?.title.trim() &&
      selection.chapters.every(
        (chapter) => chapter.title.trim() && validFolderPath(chapter.folderPath),
      ),
  );
  const allWarningsAcknowledged = Boolean(
    preview?.warnings.every(({ code }) => acknowledged.has(code)),
  );

  return (
    <Dialog
      open
      title={t("manuscriptImportTitle")}
      closeLabel={t("closeDialog")}
      onClose={() => {
        if (!importing) onClose();
      }}
      size="wide"
    >
      <div className="manuscript-import-dialog">
        <p>{t("manuscriptImportIntro")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          fieldClassName="manuscript-import-file"
          className="manuscript-import-file__input"
          label={t("manuscriptImportFile")}
          description={t("manuscriptImportFileHelp")}
          type="file"
          accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
          disabled={previewing || importing || Boolean(committedWorld)}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) inspect(file);
          }}
        />
        {previewing && (
          <p role="status" aria-live="polite">
            {t("manuscriptImportPreviewLoading")}
          </p>
        )}
        {preview && selection && (
          <section
            className="manuscript-import-preview"
            aria-label={t("manuscriptImportPreviewTitle")}
          >
            <TextField
              id="manuscript-import-project-title"
              label={t("manuscriptImportProjectTitle")}
              value={selection.title}
              maxLength={100}
              disabled={previewing || importing || Boolean(committedWorld)}
              onChange={(event) => editSelection({ ...selection, title: event.target.value })}
            />

            <section aria-labelledby="manuscript-import-counts-title">
              <h3 id="manuscript-import-counts-title">{t("manuscriptImportCounts")}</h3>
              <p className="manuscript-import-counts__help">{t("manuscriptImportCountsHelp")}</p>
              <dl className="manuscript-import-counts">
                <div>
                  <dt>{t("manuscriptImportSourceWords")}</dt>
                  <dd>{preview.counts.sourceWords}</dd>
                </div>
                <div>
                  <dt>{t("manuscriptImportImportedWords")}</dt>
                  <dd>{preview.counts.importedWords}</dd>
                </div>
                <div>
                  <dt>{t("manuscriptImportSourceParagraphs")}</dt>
                  <dd>{preview.counts.sourceParagraphs}</dd>
                </div>
                <div>
                  <dt>{t("manuscriptImportImportedParagraphs")}</dt>
                  <dd>{preview.counts.importedParagraphs}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="manuscript-import-chapters-title">
              <h3 id="manuscript-import-chapters-title">{t("manuscriptImportChapters")}</h3>
              <ScrollArea as="ol" axis="y" surface="panel" className="manuscript-import-chapters">
                {selection.chapters.map((chapter, index) => {
                  const chapterKey = chapter.sourceIndexes.join("-");
                  const reviewedChapter = preview.chapters.find((candidate) =>
                    sourceIndexesEqual(candidate.sourceIndexes, chapter.sourceIndexes),
                  );
                  return (
                    <li key={chapter.sourceIndexes.join("-")}>
                      <TextField
                        ref={(element) => {
                          if (element) chapterTitleRefs.current.set(chapterKey, element);
                          else chapterTitleRefs.current.delete(chapterKey);
                        }}
                        label={t("manuscriptImportChapterTitle", { number: index + 1 })}
                        value={chapter.title}
                        maxLength={1000}
                        disabled={previewing || importing || Boolean(committedWorld)}
                        onChange={(event) => {
                          const chapters = selection.chapters.map((item, chapterIndex) =>
                            chapterIndex === index ? { ...item, title: event.target.value } : item,
                          );
                          editSelection({ ...selection, chapters });
                        }}
                      />
                      <TextField
                        label={t("manuscriptImportFolderPath", { number: index + 1 })}
                        value={folderPathInput(chapter.folderPath)}
                        maxLength={8007}
                        hint={t("manuscriptImportFolderPathHint")}
                        error={
                          validFolderPath(chapter.folderPath)
                            ? undefined
                            : t("manuscriptImportFolderPathInvalid")
                        }
                        disabled={previewing || importing || Boolean(committedWorld)}
                        onChange={(event) => {
                          const chapters = selection.chapters.map((item, chapterIndex) =>
                            chapterIndex === index
                              ? { ...item, folderPath: folderPathFromInput(event.target.value) }
                              : item,
                          );
                          editSelection({ ...selection, chapters });
                        }}
                      />
                      {index > 0 && (
                        <Button
                          appearance="secondary"
                          labelOverflow="wrap"
                          disabled={previewing || importing || Boolean(committedWorld)}
                          onClick={() => {
                            const chapters = selection.chapters.map((item) => ({
                              ...item,
                              sourceIndexes: [...item.sourceIndexes],
                            }));
                            chapters[index - 1].sourceIndexes.push(
                              ...chapters[index].sourceIndexes,
                            );
                            chapters.splice(index, 1);
                            editSelection({ ...selection, chapters });
                          }}
                        >
                          {t("manuscriptImportMergePrevious")}
                        </Button>
                      )}
                      {chapter.sourceIndexes.length > 1 && (
                        <Disclosure
                          open={splitChapter === chapter.sourceIndexes.join("-")}
                          summary={t("manuscriptImportSplitChapter", { number: index + 1 })}
                          onToggle={(event) => {
                            const key = chapter.sourceIndexes.join("-");
                            const opened = event.currentTarget.open;
                            setSplitChapter((current) =>
                              opened ? key : current === key ? null : current,
                            );
                          }}
                        >
                          {splitChapter === chapter.sourceIndexes.join("-") && (
                            <ScrollArea
                              axis="y"
                              surface="panel"
                              className="manuscript-import-boundaries"
                            >
                              {chapter.sourceIndexes.slice(1).map((unitIndex) => {
                                const unit = preview.units[unitIndex];
                                if (!unit) return null;
                                const unitExcerpt =
                                  excerpt(unit.text) || t("manuscriptImportEmptyUnit");
                                return (
                                  <Button
                                    key={unitIndex}
                                    appearance="secondary"
                                    labelOverflow="wrap"
                                    disabled={previewing || importing || Boolean(committedWorld)}
                                    onClick={() => {
                                      const splitAt = chapter.sourceIndexes.indexOf(unitIndex);
                                      const before = chapter.sourceIndexes.slice(0, splitAt);
                                      const after = chapter.sourceIndexes.slice(splitAt);
                                      const chapters = selection.chapters.map((item) => ({
                                        ...item,
                                        sourceIndexes: [...item.sourceIndexes],
                                        folderPath: [...item.folderPath],
                                      }));
                                      chapters.splice(
                                        index,
                                        1,
                                        { ...chapters[index], sourceIndexes: before },
                                        {
                                          sourceIndexes: after,
                                          title: unit.isHeading
                                            ? unit.text.trim().slice(0, 1000)
                                            : t("manuscriptImportNewChapterTitle", {
                                                number: index + 2,
                                              }),
                                          folderPath: [...chapter.folderPath],
                                        },
                                      );
                                      setSplitChapter(null);
                                      setPendingFocusKey(after.join("-"));
                                      editSelection({ ...selection, chapters });
                                    }}
                                  >
                                    {t("manuscriptImportSplitBefore", {
                                      number: unit.index + 1,
                                      excerpt: unitExcerpt,
                                    })}
                                  </Button>
                                );
                              })}
                            </ScrollArea>
                          )}
                        </Disclosure>
                      )}
                      {reviewedChapter &&
                        (() => {
                          const chapterKey = reviewedChapter.sourceIndexes.join("-");
                          return (
                            <Disclosure
                              open={expandedChapter === chapterKey}
                              summary={t("manuscriptImportReviewChapter", {
                                title: reviewedChapter.title,
                              })}
                              onToggle={(event) => {
                                const opened = event.currentTarget.open;
                                setExpandedChapter((current) =>
                                  opened ? chapterKey : current === chapterKey ? null : current,
                                );
                              }}
                            >
                              {expandedChapter === chapterKey && (
                                <FormattedText
                                  body={reviewedChapter.body}
                                  marks={reviewedChapter.marks}
                                />
                              )}
                            </Disclosure>
                          );
                        })()}
                    </li>
                  );
                })}
              </ScrollArea>
            </section>

            {!reviewed && (
              <Alert
                tone="warning"
                action={
                  <Button
                    icon={<RefreshCw />}
                    labelOverflow="wrap"
                    disabled={!source || !selectionValid || previewing || importing}
                    onClick={() => {
                      if (source) void requestPreview(source, selection);
                    }}
                  >
                    {t("manuscriptImportRefreshPreview")}
                  </Button>
                }
              >
                {t("manuscriptImportRefreshRequired")}
              </Alert>
            )}

            {preview.warnings.length > 0 && (
              <section
                className="manuscript-import-warnings"
                aria-labelledby="manuscript-import-warnings-title"
              >
                <h3 id="manuscript-import-warnings-title">{t("manuscriptImportWarnings")}</h3>
                <p>{t("manuscriptImportWarningsIntro")}</p>
                {preview.warnings.map(({ code, count }) => {
                  const label = t(warningLabels[code]);
                  return (
                    <Checkbox
                      key={code}
                      checked={acknowledged.has(code)}
                      disabled={!reviewed || importing || Boolean(committedWorld)}
                      label={t("manuscriptImportWarningAcknowledge", { label, count })}
                      description={t(warningHelp[code])}
                      onChange={(event) => {
                        const next = new Set(acknowledged);
                        if (event.target.checked) next.add(code);
                        else next.delete(code);
                        setAcknowledged(next);
                      }}
                    />
                  );
                })}
              </section>
            )}
            <p>{t("manuscriptImportCreatesNew")}</p>
          </section>
        )}
        <div className="manuscript-import-actions">
          <Button appearance="ghost" disabled={importing} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            appearance="primary"
            icon={<Upload />}
            labelOverflow="wrap"
            disabled={
              (!committedWorld &&
                (!preview ||
                  !selection ||
                  !reviewed ||
                  !selectionValid ||
                  !allWarningsAcknowledged)) ||
              previewing ||
              importing
            }
            loading={importing}
            loadingLabel={t("manuscriptImporting")}
            onClick={() => void importManuscript()}
          >
            {t(committedWorld ? "manuscriptImportOpenAction" : "manuscriptImportAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
