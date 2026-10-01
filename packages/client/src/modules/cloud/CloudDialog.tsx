import { Cloud, LogIn, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, ConfirmDialog, Dialog, Disclosure } from "../../design";
import { type MessageKey, useI18n } from "../../i18n";
import {
  applicationErrorMessage,
  ApplicationGatewayError,
  type BackupLoginStatus,
  type CloudSyncAction,
  type CloudSyncPreview,
  type CloudSyncState,
  type CloudSyncStatus,
  quiltorClient,
} from "../../platform";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import type { Manuscript } from "../manuscript";
import "./CloudDialog.css";

const stateLabels: Record<CloudSyncState, MessageKey> = {
  unconfigured: "cloudUnconfigured",
  unlinked: "cloudUnlinked",
  synced: "cloudSynced",
  "local-pending": "cloudLocalPending",
  "remote-pending": "cloudRemotePending",
  conflict: "cloudConflict",
};

export function CloudDialog({
  onClose,
  flush,
  manuscript,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
  manuscript: Manuscript;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [login, setLogin] = useState<BackupLoginStatus | null>(null);
  const [preview, setPreview] = useState<CloudSyncPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [stateWarning, setStateWarning] = useState(false);
  const [confirmation, setConfirmation] = useState<Exclude<CloudSyncAction, "sync"> | null>(null);
  const operation = useRef(false);

  const load = async () => {
    setError("");
    setPreview(null);
    const auth = await quiltorClient.application.backup.loginStatus();
    setLogin(auth);
    if (!auth.configured || auth.signedIn)
      setStatus(await quiltorClient.application.synchronization.status());
    else setStatus(null);
  };
  useFlushedEffect(
    flush,
    async () => {
      try {
        await load();
      } finally {
        setBusy(false);
      }
    },
    (failure) => {
      setError(applicationErrorMessage(failure));
      setBusy(false);
    },
  );

  const run = async (action: () => Promise<void>, saveFirst = true) => {
    if (operation.current || reloadRequired) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      if (saveFirst) await flush();
      await action();
    } catch (failure) {
      setError(applicationErrorMessage(failure));
      setPreview(null);
      if (failure instanceof ApplicationGatewayError && failure.code === "sync.recovery_required") {
        setRecoveryRequired(true);
        setReloadRequired(true);
      }
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const synchronize = (action: CloudSyncAction) =>
    run(async () => {
      setConfirmation(null);
      const result = await quiltorClient.application.synchronization.synchronize({
        action,
        ...(action === "sync" || !status
          ? {}
          : {
              expectedGeneration: status.remote.generation,
              expectedLocalFingerprint: status.localFingerprint,
            }),
      });
      setStatus(result.status);
      setPreview(null);
      setReloadRequired(result.reloadRequired);
      setStateWarning(result.warnings?.includes("sync.state_not_saved") === true);
    });
  const readOnly = status?.account?.access === "read-only";
  const requiresChoice = status?.state === "conflict" || status?.state === "unlinked";
  const canResolve =
    requiresChoice &&
    status &&
    preview?.generation === status.remote.generation &&
    preview?.snapshotId === status.remote.snapshotId &&
    !error &&
    !busy;
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const contents = (document: Manuscript) => (
    <div className="cloud-sync__chapters">
      <p>
        {t("backupChapterCount", { count: document.chapters.length })} ·{" "}
        {t("backupTrashCount", { count: document.trash?.length ?? 0 })}
      </p>
      {document.chapters.map((chapter) => (
        <Disclosure
          key={chapter.id}
          summary={`${chapter.title}${chapter.inBook === false ? ` · ${t("cloudSetAside")}` : ""}`}
        >
          <p className="cloud-sync__text">{chapter.body || t("backupEmptyChapter")}</p>
        </Disclosure>
      ))}
      {(document.trash ?? []).map(({ chapter }) => (
        <Disclosure key={`trash-${chapter.id}`} summary={`${chapter.title} · ${t("cloudInTrash")}`}>
          <p className="cloud-sync__text">{chapter.body || t("backupEmptyChapter")}</p>
        </Disclosure>
      ))}
    </div>
  );
  return (
    <>
      <Dialog
        title={t("cloudTitle")}
        closeLabel={t("close")}
        onClose={() => {
          if (!busy && !reloadRequired) onClose();
        }}
        size="wide"
        footer={
          reloadRequired ? (
            <Button appearance="primary" onClick={() => location.reload()}>
              {t("reloadAfterRestore")}
            </Button>
          ) : (
            <>
              <Button
                appearance="secondary"
                icon={<RefreshCw />}
                disabled={busy}
                onClick={() => void run(load)}
              >
                {t("cloudRefresh")}
              </Button>
              {status?.configured && !requiresChoice && (
                <Button
                  appearance="primary"
                  icon={<Cloud />}
                  disabled={
                    busy ||
                    !!error ||
                    (readOnly && status.state !== "remote-pending" && status.state !== "synced")
                  }
                  onClick={() => void synchronize("sync")}
                >
                  {t("cloudSyncNow")}
                </Button>
              )}
            </>
          )
        }
      >
        <div className="cloud-sync" aria-busy={busy}>
          <p>{t("cloudManualExplanation")}</p>
          <p>{t("cloudLocalIndependence")}</p>
          {error && (
            <Alert tone="danger">
              {error}
              {!recoveryRequired && <p>{t("cloudErrorHelp")}</p>}
            </Alert>
          )}
          {busy && <p role="status">{t("cloudWorking")}</p>}
          {reloadRequired && !recoveryRequired && (
            <Alert tone="success">{t("cloudReloadRequired")}</Alert>
          )}
          {stateWarning && <Alert tone="warning">{t("cloudStateNotSaved")}</Alert>}
          {login?.configured && !login.signedIn && (
            <Alert tone="info">
              <p>{t(login.hosted ? "backupSessionExpired" : "backupSignInHint")}</p>
              {!login.hosted && (
                <Button
                  appearance="secondary"
                  icon={<LogIn />}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await quiltorClient.application.backup.beginLogin();
                      quiltorClient.platform.externalNavigation.open(result.authorizeUrl);
                    })
                  }
                >
                  {t("backupSignIn")}
                </Button>
              )}
            </Alert>
          )}
          {status && (
            <>
              {!error && !busy && (
                <p className="cloud-sync__state" role="status">
                  {t(stateLabels[status.state])}
                </p>
              )}
              {!status.configured && <p>{t("cloudSetupHint")}</p>}
              <dl className="cloud-sync__facts">
                <dt>{t("target")}</dt>
                <dd>{status.endpoint || t("notConfigured")}</dd>
                <dt>{t("cloudLastSync")}</dt>
                <dd>
                  {status.lastSyncedAt ? date(status.lastSyncedAt) : t("noConfirmedTransfer")}
                </dd>
                {status.account && (
                  <>
                    <dt>{t("cloudStorage")}</dt>
                    <dd>
                      {t("cloudUsedBytes", { used: number(status.account.usedBytes) })}
                      {status.account.limitBytes !== null
                        ? ` / ${number(status.account.limitBytes)} Bytes`
                        : ` · ${t("cloudNoQuotaSpecified")}`}
                    </dd>
                  </>
                )}
              </dl>
              {readOnly && <Alert tone="warning">{t("cloudReadOnly")}</Alert>}
              {status.account?.deleteAfter && (
                <Alert tone="warning">
                  {t("cloudDeletionDate", { date: date(status.account.deleteAfter) })}
                </Alert>
              )}
              {requiresChoice && !reloadRequired && (
                <section aria-label={t("cloudConflict")}>
                  <Alert tone="warning">
                    {t(status.state === "unlinked" ? "cloudUnlinkedHelp" : "cloudConflictHelp")}
                  </Alert>
                  <Button
                    appearance="secondary"
                    disabled={busy || !!error}
                    onClick={() =>
                      void run(async () => {
                        const value = await quiltorClient.application.synchronization.preview();
                        if (
                          value.generation !== status.remote.generation ||
                          value.snapshotId !== status.remote.snapshotId
                        ) {
                          await load();
                          return;
                        }
                        setPreview(value);
                      })
                    }
                  >
                    {t("cloudInspectRemote")}
                  </Button>
                  {preview && (
                    <div className="cloud-sync__comparison">
                      <section>
                        <h3>{t("cloudLocalVersion")}</h3>
                        {contents(manuscript)}
                      </section>
                      <section>
                        <h3>{t("cloudRemoteVersion")}</h3>
                        {contents(preview.documents.manuscript)}
                        <p>
                          {t("backupFigureCount", {
                            count: preview.documents.figures.nodes.length,
                          })}{" "}
                          ·{" "}
                          {t("backupBoardCount", {
                            count: preview.documents.storyboards.boards?.length ?? 0,
                          })}
                        </p>
                      </section>
                    </div>
                  )}
                  <div className="cloud-sync__actions">
                    <Button
                      appearance="secondary"
                      disabled={!canResolve || readOnly}
                      onClick={() => setConfirmation("keep-local")}
                    >
                      {t("cloudKeepLocal")}
                    </Button>
                    <Button
                      appearance="secondary"
                      disabled={!canResolve}
                      onClick={() => setConfirmation("use-remote")}
                    >
                      {t("cloudUseRemote")}
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </Dialog>
      {confirmation && (
        <ConfirmDialog
          title={t(confirmation === "keep-local" ? "cloudKeepLocal" : "cloudUseRemote")}
          description={t("cloudResolveConfirmation")}
          closeLabel={t("closeDialog")}
          confirmLabel={t("cloudConfirmResolution")}
          cancelLabel={t("cancel")}
          onConfirm={() => void synchronize(confirmation)}
          onClose={() => setConfirmation(null)}
        />
      )}
    </>
  );
}
