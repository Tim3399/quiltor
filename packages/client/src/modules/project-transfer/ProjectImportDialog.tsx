import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, Dialog, TextField } from "../../design";
import { useI18n } from "../../i18n";
import {
  applicationErrorMessage,
  type ProjectTransferPreview,
  quiltorClient,
} from "../../platform";
import type { WorldInfo } from "../story-world";
import "./ProjectTransfer.css";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export function ProjectImportDialog({
  onImported,
  onClose,
}: {
  onImported: (world: WorldInfo) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const generation = useRef(0);
  const [archive, setArchive] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProjectTransferPreview | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [committedWorld, setCommittedWorld] = useState<WorldInfo | null>(null);

  const inspect = async (file: File) => {
    const nextGeneration = ++generation.current;
    setArchive(file);
    setPreview(null);
    setError("");
    if (file.size > MAX_ARCHIVE_BYTES) {
      setError(t("projectTransferTooLarge"));
      return;
    }
    setPreviewing(true);
    try {
      const result = await quiltorClient.application.projectTransfer.preview(file);
      if (generation.current === nextGeneration) setPreview(result.preview);
    } catch (reason) {
      if (generation.current === nextGeneration) setError(applicationErrorMessage(reason));
    } finally {
      if (generation.current === nextGeneration) setPreviewing(false);
    }
  };

  const importArchive = async () => {
    if ((!archive || !preview) && !committedWorld) return;
    if (importing) return;
    const selected = archive;
    const authorizedPreview = preview;
    setImporting(true);
    setError("");
    let importCommitted = Boolean(committedWorld);
    try {
      const world = committedWorld
        ? committedWorld
        : (await quiltorClient.application.projectTransfer.importProject(selected as File)).world;
      if (!committedWorld && (archive !== selected || preview !== authorizedPreview)) return;
      setCommittedWorld(world);
      importCommitted = true;
      await onImported(world);
      onClose();
    } catch (reason) {
      setError(importCommitted ? t("projectImportOpenFailed") : applicationErrorMessage(reason));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open
      title={t("projectImportTitle")}
      closeLabel={t("closeDialog")}
      onClose={() => {
        if (!importing) onClose();
      }}
      size="wide"
    >
      <div className="project-transfer-dialog">
        <p>{t("projectImportIntro")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          fieldClassName="project-transfer-file"
          className="project-transfer-file__input"
          label={t("projectArchiveFile")}
          type="file"
          accept=".quiltor,application/zip,application/octet-stream"
          disabled={previewing || importing || Boolean(committedWorld)}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void inspect(file);
          }}
        />
        {previewing && (
          <p role="status" aria-live="polite">
            {t("projectPreviewLoading")}
          </p>
        )}
        {preview && (
          <section className="project-transfer-preview" aria-label={t("projectPreviewTitle")}>
            <h3>{preview.title}</h3>
            <dl>
              <div>
                <dt>{t("projectCountChapters")}</dt>
                <dd>{preview.counts.chapters}</dd>
              </div>
              <div>
                <dt>{t("projectCountBookChapters")}</dt>
                <dd>{preview.counts.bookChapters}</dd>
              </div>
              <div>
                <dt>{t("projectCountSetAside")}</dt>
                <dd>{preview.counts.setAsideChapters}</dd>
              </div>
              <div>
                <dt>{t("projectCountTrash")}</dt>
                <dd>{preview.counts.trashedChapters}</dd>
              </div>
              <div>
                <dt>{t("projectCountFigures")}</dt>
                <dd>{preview.counts.figures}</dd>
              </div>
              <div>
                <dt>{t("projectCountStoryboards")}</dt>
                <dd>{preview.counts.storyboards}</dd>
              </div>
              <div>
                <dt>{t("projectCountImages")}</dt>
                <dd>{preview.counts.images}</dd>
              </div>
            </dl>
            <p>{t("projectIncludesTrash")}</p>
            <p>{t("projectExcludesHistory")}</p>
            <p>{t("projectImportCreatesNew")}</p>
          </section>
        )}
        <div className="project-transfer-actions">
          <Button appearance="ghost" disabled={importing} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            appearance="primary"
            icon={<Upload />}
            disabled={(!preview && !committedWorld) || previewing || importing}
            loading={importing}
            loadingLabel={t("projectImporting")}
            onClick={() => void importArchive()}
          >
            {t(committedWorld ? "projectImportOpenAction" : "projectImportAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
