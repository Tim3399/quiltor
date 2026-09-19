import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, Button, ConfirmDialog, Dialog, EmptyState, TextField } from "../../design";
import { useI18n } from "../../i18n";
import type { Manuscript } from "./model";
import {
  ChapterRestoreError,
  purgeTrashedChapter,
  restoreTrashedChapter,
  searchChapterTrash,
} from "./trash";
import "./ChapterTrashDialog.css";

interface ChapterTrashDialogProps {
  manuscript: Manuscript;
  availableMomentIds?: ReadonlySet<string>;
  onChange: (manuscript: Manuscript) => void;
  onClose: () => void;
}

export function ChapterTrashDialog({
  manuscript,
  availableMomentIds,
  onChange,
  onClose,
}: ChapterTrashDialogProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [purgeId, setPurgeId] = useState("");
  const [message, setMessage] = useState("");
  const entries = useMemo(
    () => searchChapterTrash(manuscript.trash ?? [], query),
    [manuscript.trash, query],
  );
  const restore = (chapterId: string) => {
    try {
      const result = restoreTrashedChapter(manuscript, chapterId, { availableMomentIds });
      onChange(result.manuscript);
      setMessage(result.restoredToRoot ? t("trashRestoredToRoot") : t("trashRestored"));
    } catch (error) {
      setMessage(
        error instanceof ChapterRestoreError
          ? error.message.includes("collision")
            ? t("trashRestoreCollision")
            : error.message === "missing-story-time-target"
              ? t("trashRestoreMissingStoryTime")
              : t("trashRestoreError")
          : t("trashRestoreError"),
      );
    }
  };
  const purgeTarget = manuscript.trash?.find((entry) => entry.chapter.id === purgeId);
  return (
    <>
      <Dialog title={t("chapterTrash")} closeLabel={t("closeDialog")} onClose={onClose} size="wide">
        <div className="chapter-trash">
          <TextField
            label={t("searchChapterTrash")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {message && (
            <Alert tone={message === t("trashRestored") ? "success" : "warning"}>{message}</Alert>
          )}
          {!entries.length ? (
            <EmptyState
              icon={<Trash2 />}
              title={query ? t("trashNoSearchResults") : t("chapterTrashEmpty")}
              headingLevel={3}
            />
          ) : (
            <ul className="chapter-trash__list">
              {entries.map((entry) => (
                <li key={entry.chapter.id} className="chapter-trash__item">
                  <div>
                    <strong>{entry.chapter.title || t("untitled")}</strong>
                    <span className="chapter-trash__type">{t("chapter")}</span>
                    <small>
                      {entry.originalFolderPath.map((folder) => folder.title).join(" / ") ||
                        t("trashRootPath")}{" "}
                      · {new Date(entry.deletedAt).toLocaleString(locale)}
                    </small>
                    {entry.treeItem.parentFolderId &&
                      !manuscript.structure?.folders.some(
                        (folder) => folder.id === entry.treeItem.parentFolderId,
                      ) && (
                        <small className="chapter-trash__warning">{t("trashFolderMissing")}</small>
                      )}
                    <p>{entry.chapter.body.slice(0, 180) || t("trashEmptyText")}</p>
                  </div>
                  <div className="chapter-trash__actions">
                    <Button
                      appearance="secondary"
                      icon={<RotateCcw />}
                      onClick={() => restore(entry.chapter.id)}
                    >
                      {t("restoreChapter")}
                    </Button>
                    <Button
                      tone="danger"
                      icon={<Trash2 />}
                      onClick={() => setPurgeId(entry.chapter.id)}
                    >
                      {t("purgeChapter")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
      {purgeTarget && (
        <ConfirmDialog
          title={t("purgeChapter")}
          description={t("purgeChapterDescription", {
            title: purgeTarget.chapter.title || t("untitled"),
          })}
          confirmLabel={t("purgeChapter")}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          onClose={() => setPurgeId("")}
          onConfirm={() => {
            onChange(purgeTrashedChapter(manuscript, purgeTarget.chapter.id));
            setPurgeId("");
          }}
        />
      )}
    </>
  );
}
