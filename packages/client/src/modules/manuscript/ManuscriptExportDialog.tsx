import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Dialog, ScrollArea } from "../../design";
import { type MessageKey, useI18n } from "../../i18n";
import {
  applicationErrorMessage,
  type ManuscriptDocxPreset,
  type ManuscriptDocxPreview,
  type ManuscriptDocxWarningCode,
  quiltorClient,
} from "../../platform";
import "./ManuscriptExportDialog.css";

const warningLabels: Record<ManuscriptDocxWarningCode, MessageKey> = {
  notes: "manuscriptExportWarningNotes",
  references: "manuscriptExportWarningReferences",
  folders: "manuscriptExportWarningFolders",
  excluded_chapters: "manuscriptExportWarningExcludedChapters",
  extensions: "manuscriptExportWarningExtensions",
};

const errorMessages: Record<string, MessageKey> = {
  "manuscript_export.invalid_request": "errorManuscriptExportInvalidRequest",
  "manuscript_export.empty_book": "errorManuscriptExportEmptyBook",
  "manuscript_export.invalid_content": "errorManuscriptExportInvalidContent",
  "manuscript_export.limit_exceeded": "errorManuscriptExportLimitExceeded",
  "manuscript_export.preview_mismatch": "errorManuscriptExportPreviewMismatch",
  "manuscript_export.warnings_unacknowledged": "errorManuscriptExportWarningsUnacknowledged",
};

function errorCode(reason: unknown): string | undefined {
  if (!reason || typeof reason !== "object") return undefined;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function ManuscriptExportDialog({
  preset,
  onSave,
  onClose,
}: {
  preset: ManuscriptDocxPreset;
  onSave?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ManuscriptDocxPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const requestGeneration = useRef(0);
  const lifecycleGeneration = useRef(0);
  const exportInFlight = useRef(false);

  const messageFor = useCallback(
    (reason: unknown, fallback: MessageKey) => {
      const key = errorMessages[errorCode(reason) ?? ""];
      return key ? t(key) : `${t(fallback)} ${applicationErrorMessage(reason)}`;
    },
    [t],
  );

  const loadPreview = useCallback(async () => {
    const request = ++requestGeneration.current;
    setPreviewing(true);
    setPreview(null);
    setAcknowledged(false);
    setDownloaded(false);
    setError("");
    try {
      await onSave?.();
      if (requestGeneration.current !== request) return;
      const result = await quiltorClient.application.documents.previewManuscriptDocx(preset);
      if (requestGeneration.current !== request) return;
      setPreview(result.preview);
    } catch (reason) {
      if (requestGeneration.current === request) {
        setError(messageFor(reason, "manuscriptExportPreviewFailed"));
      }
    } finally {
      if (requestGeneration.current === request) setPreviewing(false);
    }
  }, [messageFor, onSave, preset]);

  useEffect(() => {
    void loadPreview();
    return () => {
      requestGeneration.current += 1;
      lifecycleGeneration.current += 1;
    };
  }, [loadPreview]);

  const download = async () => {
    if (!preview || exportInFlight.current) return;
    exportInFlight.current = true;
    const lifecycle = lifecycleGeneration.current;
    setExporting(true);
    setDownloaded(false);
    setError("");
    let stage: "render" | "save" = "render";
    try {
      await onSave?.();
      if (lifecycleGeneration.current !== lifecycle) return;
      const blob = await quiltorClient.application.documents.renderManuscriptDocx(
        preview,
        preview.warnings.map(({ code }) => code).filter(() => acknowledged),
      );
      if (lifecycleGeneration.current !== lifecycle) return;
      stage = "save";
      const saveStatus = await quiltorClient.application.documents.saveManuscriptDocx(
        blob,
        preview.fileName,
      );
      if (lifecycleGeneration.current !== lifecycle) return;
      if (saveStatus === "saved") setDownloaded(true);
    } catch (reason) {
      if (lifecycleGeneration.current !== lifecycle) return;
      if (errorCode(reason) === "manuscript_export.preview_mismatch") {
        setPreview(null);
        setAcknowledged(false);
      }
      setError(
        messageFor(
          reason,
          stage === "render" ? "manuscriptExportRenderFailed" : "manuscriptExportSaveFailed",
        ),
      );
    } finally {
      exportInFlight.current = false;
      if (lifecycleGeneration.current === lifecycle) setExporting(false);
    }
  };

  const warningsReady = Boolean(preview && (!preview.warnings.length || acknowledged));

  return (
    <Dialog
      open
      size="wide"
      title={t("manuscriptExportTitle")}
      closeLabel={t("closeDialog")}
      onClose={exporting ? () => undefined : onClose}
    >
      <div className="manuscript-export-dialog">
        {error && <Alert tone="danger">{error}</Alert>}
        {downloaded && <Alert tone="success">{t("manuscriptExportDownloaded")}</Alert>}
        {previewing && (
          <p role="status" aria-live="polite">
            {t("manuscriptExportPreviewLoading")}
          </p>
        )}
        {!previewing && !preview && (
          <Button icon={<RefreshCw />} labelOverflow="wrap" onClick={() => void loadPreview()}>
            {t("manuscriptExportRefreshPreview")}
          </Button>
        )}
        {preview && (
          <section aria-label={t("manuscriptExportContentPreview")}>
            <h3>{t("manuscriptExportContentPreview")}</h3>
            <p>
              {t(
                preset === "editor"
                  ? "manuscriptExportEditorDescription"
                  : "manuscriptExportNormseiteDescription",
              )}
            </p>
            <p>{t("manuscriptExportScope")}</p>
            <p>{t("manuscriptExportPagination")}</p>
            <p>{t("manuscriptExportNoExtras")}</p>
            <dl className="manuscript-export-counts">
              <div>
                <dt>{t("manuscriptExportManuscriptChapters")}</dt>
                <dd>{preview.counts.manuscriptChapters}</dd>
              </div>
              <div>
                <dt>{t("manuscriptExportExportedChapters")}</dt>
                <dd>{preview.counts.exportedChapters}</dd>
              </div>
              <div>
                <dt>{t("manuscriptExportManuscriptWords")}</dt>
                <dd>{preview.counts.manuscriptWords}</dd>
              </div>
              <div>
                <dt>{t("manuscriptExportExportedWords")}</dt>
                <dd>{preview.counts.exportedWords}</dd>
              </div>
            </dl>
            <p>{t("manuscriptExportCountsHelp")}</p>
            <ScrollArea
              axis="y"
              surface="panel"
              className="manuscript-export-chapters"
              role="region"
              aria-label={t("manuscriptExportChapterPreview")}
              tabIndex={0}
            >
              {preview.chapters.map((chapter) => (
                <article key={chapter.id}>
                  <h4>{chapter.title.trim() || t("untitled")}</h4>
                  <small>{t("manuscriptExportChapterWords", { count: chapter.words })}</small>
                  <p>{chapter.excerpt}</p>
                </article>
              ))}
            </ScrollArea>
            {preview.warnings.length > 0 && (
              <section
                className="manuscript-export-warnings"
                aria-labelledby="manuscript-export-warnings-title"
              >
                <h3 id="manuscript-export-warnings-title">{t("manuscriptExportWarnings")}</h3>
                <p>{t("manuscriptExportWarningsHelp")}</p>
                <ul>
                  {preview.warnings.map(({ code, count }) => (
                    <li key={code}>
                      {t("manuscriptExportWarningCount", { label: t(warningLabels[code]), count })}
                    </li>
                  ))}
                </ul>
                <Checkbox
                  checked={acknowledged}
                  disabled={exporting}
                  label={t("manuscriptExportAcknowledge")}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
              </section>
            )}
          </section>
        )}
        <div className="manuscript-export-actions">
          <Button appearance="ghost" disabled={exporting} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            appearance="primary"
            icon={<Download />}
            labelOverflow="wrap"
            disabled={!warningsReady || previewing || exporting}
            loading={exporting}
            loadingLabel={t("manuscriptExportRendering")}
            onClick={() => void download()}
          >
            {t("manuscriptExportDownload")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
