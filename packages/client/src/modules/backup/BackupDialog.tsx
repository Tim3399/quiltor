import { Archive, Copy, FileText, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  IRREVERSIBLE_HOLD_MS,
  Sheet,
  SheetBody,
  SheetHeader,
} from "../../design";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import { isChapterInBook } from "../manuscript";
import type { BackupPreviewDocuments, BackupStorageLocation } from "./model";
import "./BackupDialog.css";

type BackupItem = { name: string; created: string; size: number };
type PreviewState =
  | { status: "idle" }
  | { status: "loading"; name: string }
  | { status: "ready"; name: string; documents: BackupPreviewDocuments }
  | { status: "error"; name: string; message: string };

function excerpt(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export function BackupDialog({
  onClose,
  flush,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storage, setStorage] = useState<BackupStorageLocation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [copiedPath, setCopiedPath] = useState("");
  const [error, setError] = useState("");
  const previewRequest = useRef(0);
  const restoreInFlight = useRef(false);

  useEffect(
    () => () => {
      previewRequest.current += 1;
    },
    [],
  );
  useFlushedEffect(
    flush,
    async () => {
      const [listResult, locationResult] = await Promise.all([
        quiltorClient.application.backup.list(),
        quiltorClient.application.backup.location(),
      ]);
      setItems(listResult.backups);
      setStorage(locationResult.storage);
      setLoaded(true);
    },
    (reason) => {
      setLoaded(true);
      setError(applicationErrorMessage(reason));
    },
  );

  const selectBackup = async (name: string) => {
    if (restoring || restoreWarning) return;
    const request = ++previewRequest.current;
    setSelected(name);
    setRestoreTarget(null);
    setError("");
    setPreview({ status: "loading", name });
    try {
      await flush();
      if (previewRequest.current !== request) return;
      const result = await quiltorClient.application.backup.preview(name);
      if (previewRequest.current !== request) return;
      setPreview({ status: "ready", name, documents: result.documents });
    } catch (reason) {
      if (previewRequest.current !== request) return;
      setPreview({ status: "error", name, message: applicationErrorMessage(reason) });
    }
  };

  const restore = async () => {
    if (
      restoreInFlight.current ||
      !restoreTarget ||
      preview.status !== "ready" ||
      preview.name !== restoreTarget
    )
      return;
    restoreInFlight.current = true;
    setRestoring(true);
    try {
      await flush();
      const result = await quiltorClient.application.backup.restore(restoreTarget);
      if (result.warnings?.includes("backup.mirror_failed")) {
        setRestoreTarget(null);
        setRestoring(false);
        setRestoreWarning(true);
        return;
      }
      location.reload();
    } catch (reason) {
      setError(applicationErrorMessage(reason));
      setRestoreTarget(null);
      setRestoring(false);
      restoreInFlight.current = false;
    }
  };

  const copyPath = async (path: string) => {
    try {
      await quiltorClient.platform.clipboard.writeText(path);
      setCopiedPath(path);
    } catch (reason) {
      setError(applicationErrorMessage(reason));
    }
  };

  const selectedItem = items.find((item) => item.name === selected);
  const readyPreview = preview.status === "ready" && preview.name === selected ? preview : null;
  const manuscript = readyPreview?.documents.manuscript;
  const setAsideCount =
    manuscript?.chapters.filter((chapter) => !isChapterInBook(chapter)).length ?? 0;

  return (
    <>
      <Sheet
        open
        label={t("backups")}
        onClose={restoring || restoreWarning ? () => undefined : onClose}
        wide
      >
        <div className="utility-sheet">
          <SheetHeader
            title={t("backups")}
            closeLabel={t("closeDialog")}
            onClose={restoring || restoreWarning ? () => undefined : onClose}
          />
          <SheetBody className="utility-sheet-content">
            <p className="muted">{t("backupAutoNote")}</p>
            {error && <Alert tone="danger">{error}</Alert>}
            {restoreWarning && (
              <Alert tone="warning">
                {t("backupMirrorWarning")}
                <Button appearance="secondary" size="compact" onClick={() => location.reload()}>
                  {t("reloadAfterRestore")}
                </Button>
              </Alert>
            )}
            {storage && (
              <section className="backup-storage" aria-labelledby="backup-storage-title">
                <h3 id="backup-storage-title">{t("backupStorageTitle")}</h3>
                <p>{t("backupStorageScope")}</p>
                <dl>
                  <div>
                    <dt>{t("backupDatabasePath")}</dt>
                    <dd>
                      <code>{storage.databasePath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("backupDirectory")}</dt>
                    <dd>
                      <code>{storage.backupDirectory}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("backupLastSuccessful")}</dt>
                    <dd>
                      {storage.lastSuccessfulBackup
                        ? new Date(storage.lastSuccessfulBackup).toLocaleString()
                        : t("backupNever")}
                    </dd>
                  </div>
                </dl>
                <Button
                  appearance="secondary"
                  size="compact"
                  icon={<Copy />}
                  onClick={() => void copyPath(storage.backupDirectory)}
                >
                  {copiedPath === storage.backupDirectory
                    ? t("backupPathCopied")
                    : t("backupCopyPath")}
                </Button>
              </section>
            )}
            <div className="utility-split backup-browser">
              <nav className="backup-list" aria-label={t("backups")}>
                {items.map((item) => (
                  <Button
                    key={item.name}
                    className="backup-list-item"
                    appearance="secondary"
                    icon={<Archive className="backup-list-item-icon" />}
                    aria-pressed={selected === item.name}
                    disabled={restoring || restoreWarning}
                    onClick={() => void selectBackup(item.name)}
                  >
                    <span className="backup-list-item-copy">
                      <strong>{new Date(item.created).toLocaleString()}</strong>
                      <small>{(item.size / 1024).toFixed(0)} KB</small>
                    </span>
                  </Button>
                ))}
                {!loaded && (
                  <EmptyState title={t("loadingBackupStatus")} size="compact" headingLevel={3} />
                )}
                {loaded && !items.length && !error && (
                  <EmptyState title={t("noBackup")} size="compact" headingLevel={3} />
                )}
              </nav>
              <section className="backup-preview" aria-live="polite">
                {selectedItem &&
                  preview.status === "loading" &&
                  preview.name === selectedItem.name && (
                    <EmptyState
                      icon={<Archive />}
                      title={t("backupPreviewLoading")}
                      headingLevel={3}
                    />
                  )}
                {selectedItem &&
                  preview.status === "error" &&
                  preview.name === selectedItem.name && (
                    <Alert tone="danger">{preview.message}</Alert>
                  )}
                {selectedItem && readyPreview && manuscript && (
                  <>
                    <Archive />
                    <h3>{new Date(selectedItem.created).toLocaleString()}</h3>
                    <p>
                      {t("backupPreviewDescription", {
                        size: `${(selectedItem.size / 1024).toFixed(0)} KB`,
                      })}
                    </p>
                    <div className="backup-preview-counts">
                      <span>{t("backupChapterCount", { count: manuscript.chapters.length })}</span>
                      <span>{t("backupSetAsideCount", { count: setAsideCount })}</span>
                      <span>{t("backupTrashCount", { count: manuscript.trash?.length ?? 0 })}</span>
                      <span>
                        {t("backupFigureCount", {
                          count: readyPreview.documents.figures.nodes.length,
                        })}
                      </span>
                      <span>
                        {t("backupBoardCount", {
                          count: readyPreview.documents.storyboards.boards.length,
                        })}
                      </span>
                    </div>
                    <div className="backup-preview-chapters">
                      {manuscript.chapters.map((chapter) => (
                        <article key={chapter.id}>
                          <h4>
                            <FileText />
                            {chapter.title || t("untitled")}
                            {!isChapterInBook(chapter) && (
                              <small>{t("chapterSetAsideStatus")}</small>
                            )}
                          </h4>
                          <p>{excerpt(chapter.body) || t("backupEmptyChapter")}</p>
                        </article>
                      ))}
                    </div>
                    <Button
                      appearance="primary"
                      icon={<RotateCcw />}
                      disabled={restoring || restoreWarning}
                      onClick={() => setRestoreTarget(selectedItem.name)}
                    >
                      {t("restoreBackup")}
                    </Button>
                  </>
                )}
                {!selectedItem && (
                  <EmptyState icon={<Archive />} title={t("backupSelectTitle")} headingLevel={3}>
                    <p>{t("backupSelectDescription")}</p>
                  </EmptyState>
                )}
              </section>
            </div>
          </SheetBody>
        </div>
      </Sheet>
      {restoreTarget && (
        <ConfirmDialog
          title={t("restoreBackup")}
          description={t("restoreConfirmDescription")}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("restoreBackup")}
          confirmation="hold"
          holdDurationMs={IRREVERSIBLE_HOLD_MS}
          holdLabels={{
            accessible: t("holdAriaLabel", { label: t("restoreBackup") }),
            idle: t("holdToConfirm", { label: t("restoreBackup") }),
            active: t("keepHolding"),
          }}
          onConfirm={() => void restore()}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </>
  );
}
