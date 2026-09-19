import { AlertTriangle, ClipboardCopy, Download, FileJson, GitCompareArrows } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Dialog } from "../../design";
import { useI18n } from "../../i18n";
import { quiltorClient } from "../../platform";
import type { Manuscript } from "../manuscript";
import type { FigureState } from "../story-world";
import type { StoryboardState } from "../storyboard";
import {
  conflictRecoveryJson,
  manuscriptText,
  type PersistedRecoveryDocuments,
  type RecoveryDocuments,
  recoveryJson,
} from "./recoveryExport";
import "./RecoveryDialog.css";

type RecoveryAction =
  | "copy"
  | "manuscript"
  | "documents"
  | "compare"
  | "both"
  | "keep-local"
  | "load-persisted";
type RecoveryOutcome = "completed" | "cancelled";

export function RecoveryDialog({
  manuscript,
  figures,
  storyboards,
  conflictFamily,
  onCompare,
  onKeepLocal,
  onLoadPersisted,
  onClose,
}: {
  manuscript: Manuscript;
  figures: FigureState;
  storyboards: StoryboardState;
  conflictFamily?: "manuscript" | "figures" | "storyboards";
  onCompare?: () => Promise<PersistedRecoveryDocuments>;
  onKeepLocal?: (local: RecoveryDocuments, persisted: PersistedRecoveryDocuments) => Promise<void>;
  onLoadPersisted?: (
    local: RecoveryDocuments,
    persisted: PersistedRecoveryDocuments,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const [pending, setPending] = useState<RecoveryAction | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [persisted, setPersisted] = useState<PersistedRecoveryDocuments | null>(null);
  const [authorized, setAuthorized] = useState<{
    local: RecoveryDocuments;
    persisted: PersistedRecoveryDocuments;
  } | null>(null);
  const currentDocuments = useRef({ manuscript, figures, storyboards });
  const currentPersisted = useRef(persisted);
  currentDocuments.current = { manuscript, figures, storyboards };
  currentPersisted.current = persisted;

  useEffect(() => setAuthorized(null), [manuscript, figures, storyboards, persisted]);

  const run = async (
    action: RecoveryAction,
    successMessage: string,
    task: () => Promise<RecoveryOutcome>,
  ) => {
    setPending(action);
    setMessage(null);
    try {
      const outcome = await task();
      if (outcome === "completed") setMessage({ tone: "success", text: successMessage });
    } catch {
      setMessage({ tone: "danger", text: t("recoveryExportFailed") });
    } finally {
      setPending(null);
    }
  };

  const text = () => manuscriptText(manuscript);
  const documents = (): RecoveryDocuments => ({ manuscript, figures, storyboards });
  const download = async (
    name: string,
    content: string,
    type: string,
  ): Promise<RecoveryOutcome> => {
    const result = await quiltorClient.platform.files.save(name, new Blob([content], { type }));
    if (result.status === "failed") throw new Error(result.error || t("recoveryExportFailed"));
    return result.status === "cancelled" ? "cancelled" : "completed";
  };

  return (
    <Dialog
      title={t("recoveryTitle")}
      closeLabel={t("closeDialog")}
      onClose={onClose}
      size={onCompare ? "wide" : "regular"}
      describedById={descriptionId}
      footer={
        <Button appearance="secondary" onClick={onClose}>
          {t("close")}
        </Button>
      }
    >
      <div className="recovery-dialog">
        <Alert tone="warning" icon={<AlertTriangle />}>
          <p id={descriptionId}>{t("recoveryDescription")}</p>
        </Alert>
        <div className="recovery-dialog__actions">
          <Button
            appearance="secondary"
            icon={<ClipboardCopy />}
            loading={pending === "copy"}
            disabled={pending !== null}
            loadingLabel={t("recoveryCopying")}
            onClick={() =>
              void run("copy", t("recoveryCopySucceeded"), async () => {
                await quiltorClient.platform.clipboard.writeText(text());
                return "completed";
              })
            }
          >
            {t("recoveryCopyManuscript")}
          </Button>
          <Button
            appearance="secondary"
            icon={<Download />}
            loading={pending === "manuscript"}
            disabled={pending !== null}
            loadingLabel={t("recoveryDownloading")}
            onClick={() =>
              void run("manuscript", t("recoveryDownloadSucceeded"), () =>
                download("Quiltor-Manuskript-Rettung.txt", text(), "text/plain;charset=utf-8"),
              )
            }
          >
            {t("recoveryDownloadManuscript")}
          </Button>
          <Button
            appearance="secondary"
            icon={<FileJson />}
            loading={pending === "documents"}
            disabled={pending !== null}
            loadingLabel={t("recoveryDownloading")}
            onClick={() =>
              void run("documents", t("recoveryDownloadSucceeded"), () =>
                download(
                  "Quiltor-Dokumente-Rettung.json",
                  recoveryJson(documents()),
                  "application/json;charset=utf-8",
                ),
              )
            }
          >
            {t("recoveryDownloadAll")}
          </Button>
        </div>
        <p className="recovery-dialog__scope muted">{t("recoveryJsonScope")}</p>
        {onCompare && (
          <section className="recovery-dialog__conflict" aria-labelledby="recovery-conflict-title">
            <h3 id="recovery-conflict-title">{t("recoveryConflictTitle")}</h3>
            <p>{t("recoveryConflictDescription")}</p>
            <Button
              appearance="secondary"
              icon={<GitCompareArrows />}
              loading={pending === "compare"}
              disabled={pending !== null}
              loadingLabel={t("recoveryComparing")}
              onClick={() => {
                setPending("compare");
                setMessage(null);
                void onCompare()
                  .then((next) => setPersisted(next))
                  .catch(() => setMessage({ tone: "danger", text: t("recoveryComparisonFailed") }))
                  .finally(() => setPending(null));
              }}
            >
              {persisted ? t("recoveryRefreshComparison") : t("recoveryCompare")}
            </Button>
            {persisted && (
              <>
                <div className="recovery-dialog__comparison">
                  <section>
                    <h4>{t("recoveryOwnVersion")}</h4>
                    <pre>{text() || t("recoveryEmptyManuscript")}</pre>
                  </section>
                  <section>
                    <h4>{t("recoveryPersistedVersion")}</h4>
                    <pre>
                      {manuscriptText(persisted.manuscript.document) ||
                        t("recoveryEmptyManuscript")}
                    </pre>
                  </section>
                </div>
                <div className="recovery-dialog__comparison">
                  <DocumentSummary
                    title={t("recoveryOwnPlanning")}
                    figures={figures}
                    storyboards={storyboards}
                  />
                  <DocumentSummary
                    title={t("recoveryPersistedPlanning")}
                    figures={persisted.figures.document}
                    storyboards={persisted.storyboards.document}
                  />
                </div>
                <Button
                  appearance="secondary"
                  icon={<FileJson />}
                  loading={pending === "both"}
                  disabled={pending !== null}
                  loadingLabel={t("recoveryDownloading")}
                  onClick={() => {
                    const local = documents();
                    const reviewed = persisted;
                    setPending("both");
                    setMessage(null);
                    void download(
                      "Quiltor-Konflikt-Rettung.json",
                      conflictRecoveryJson(local, reviewed),
                      "application/json;charset=utf-8",
                    )
                      .then((outcome) => {
                        if (outcome === "completed") {
                          const current = currentDocuments.current;
                          if (
                            current.manuscript === local.manuscript &&
                            current.figures === local.figures &&
                            current.storyboards === local.storyboards &&
                            currentPersisted.current === reviewed
                          ) {
                            setAuthorized({ local, persisted: reviewed });
                            setMessage({ tone: "success", text: t("recoveryBothSaved") });
                          } else {
                            setAuthorized(null);
                            setMessage({ tone: "danger", text: t("recoveryDraftChanged") });
                          }
                        }
                      })
                      .catch(() => setMessage({ tone: "danger", text: t("recoveryExportFailed") }))
                      .finally(() => setPending(null));
                  }}
                >
                  {t("recoveryDownloadBoth")}
                </Button>
                <p className="recovery-dialog__scope muted">{t("recoveryDecisionGuard")}</p>
                {conflictFamily && (
                  <p className="recovery-dialog__family">
                    {t("recoveryDecisionFamily", {
                      family: t(
                        conflictFamily === "manuscript"
                          ? "recoveryFamilyManuscript"
                          : conflictFamily === "figures"
                            ? "recoveryFamilyWorld"
                            : "recoveryFamilyStoryboard",
                      ),
                    })}
                  </p>
                )}
                <div className="recovery-dialog__decisions">
                  <Button
                    appearance="secondary"
                    loading={pending === "keep-local"}
                    disabled={pending !== null || !authorized || !onKeepLocal}
                    loadingLabel={t("recoveryResolving")}
                    onClick={() => {
                      if (!authorized || !onKeepLocal) return;
                      setPending("keep-local");
                      setMessage(null);
                      void onKeepLocal(authorized.local, authorized.persisted)
                        .then(onClose)
                        .catch((reason) => {
                          setAuthorized(null);
                          setMessage({
                            tone: "danger",
                            text:
                              reason instanceof Error
                                ? reason.message
                                : t("recoveryResolutionFailed"),
                          });
                        })
                        .finally(() => setPending(null));
                    }}
                  >
                    {t("recoveryKeepLocal")}
                  </Button>
                  <Button
                    appearance="secondary"
                    loading={pending === "load-persisted"}
                    disabled={pending !== null || !authorized || !onLoadPersisted}
                    loadingLabel={t("recoveryResolving")}
                    onClick={() => {
                      if (!authorized || !onLoadPersisted) return;
                      setPending("load-persisted");
                      setMessage(null);
                      void onLoadPersisted(authorized.local, authorized.persisted)
                        .then(onClose)
                        .catch((reason) => {
                          setAuthorized(null);
                          setMessage({
                            tone: "danger",
                            text:
                              reason instanceof Error
                                ? reason.message
                                : t("recoveryResolutionFailed"),
                          });
                        })
                        .finally(() => setPending(null));
                    }}
                  >
                    {t("recoveryLoadPersisted")}
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <p className="recovery-dialog__note muted">{t("recoveryKeepEditing")}</p>
      </div>
    </Dialog>
  );
}

function DocumentSummary({
  title,
  figures,
  storyboards,
}: {
  title: string;
  figures: FigureState;
  storyboards: StoryboardState;
}) {
  const { t } = useI18n();
  return (
    <section className="recovery-dialog__summary">
      <h4>{title}</h4>
      <dl>
        <div>
          <dt>{t("recoveryWorldElements")}</dt>
          <dd>{figures.nodes.length}</dd>
        </div>
        <div>
          <dt>{t("recoveryWorldRelationships")}</dt>
          <dd>{figures.edges.length}</dd>
        </div>
        <div>
          <dt>{t("recoveryStoryboardBoards")}</dt>
          <dd>{storyboards.boards.length}</dd>
        </div>
        <div>
          <dt>{t("recoveryStoryboardCards")}</dt>
          <dd>{storyboards.nodes.length}</dd>
        </div>
      </dl>
      <details>
        <summary>{t("recoveryInspectPlanning")}</summary>
        <pre>{JSON.stringify({ figures, storyboards }, null, 2)}</pre>
      </details>
    </section>
  );
}
