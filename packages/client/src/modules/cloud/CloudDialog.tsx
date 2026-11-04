import { Cloud, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, ConfirmDialog, Dialog, Disclosure, TextField } from "../../design";
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
  type SyncTarget,
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
  onDocumentsReplaced,
  embedded = false,
  onBusyChange,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
  manuscript: Manuscript;
  /** The server now holds other documents than the open workspace; nothing may save over them. */
  onDocumentsReplaced: () => void;
  /** Body and actions without the dialog frame: the versions dialog hosts it as a tab. */
  embedded?: boolean;
  /** Reports a running sync or a pending reload, so the host can keep the tab from changing. */
  onBusyChange?: (busy: boolean) => void;
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
  const [target, setTarget] = useState<SyncTarget | null>(null);
  const [address, setAddress] = useState("");
  const [targetSaved, setTargetSaved] = useState(false);
  const operation = useRef(false);

  const load = async () => {
    setError("");
    setPreview(null);
    const where = await quiltorClient.application.synchronization.target();
    setTarget(where);
    setAddress(where.worldUrl);
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
        onDocumentsReplaced();
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
      if (result.reloadRequired) onDocumentsReplaced();
      setReloadRequired(result.reloadRequired);
      setStateWarning(result.warnings?.includes("sync.state_not_saved") === true);
    });
  // Setting the address needs no save first: it changes where the project syncs, not the project.
  const saveTarget = (value: string) =>
    run(async () => {
      setTargetSaved(false);
      await quiltorClient.application.synchronization.setTarget(value);
      await load();
      setTargetSaved(true);
    }, false);
  const targetForm = (submitLabel: MessageKey) => (
    <form
      className="cloud-sync__target"
      onSubmit={(event) => {
        event.preventDefault();
        if (address.trim()) void saveTarget(address.trim());
      }}
    >
      <TextField
        id="sync-target-address"
        label={t("syncTargetAddress")}
        inputMode="url"
        autoComplete="url"
        value={address}
        placeholder={t("syncTargetExample")}
        hint={t("syncTargetHint")}
        onChange={(event) => setAddress(event.target.value)}
      />
      <div className="cloud-sync__actions">
        <Button type="submit" appearance="primary" disabled={busy || !address.trim()}>
          {t(submitLabel)}
        </Button>
        {target?.source === "world" && (
          <Button appearance="secondary" disabled={busy} onClick={() => void saveTarget("")}>
            {t(target.operatorUrl ? "syncTargetUseOperator" : "syncTargetRemove")}
          </Button>
        )}
      </div>
    </form>
  );
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
  const hostBusy = busy || reloadRequired;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the value is reported.
  useEffect(() => onBusyChange?.(hostBusy), [hostBusy]);
  const footer = reloadRequired ? (
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
  );
  const body = (
    <div className="cloud-sync" aria-busy={busy}>
      <p className="muted">{t("cloudManualExplanation")}</p>
      <p className="muted">{t("cloudLocalIndependence")}</p>
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
      {targetSaved && !error && (
        <Alert tone="success">
          {t(target?.source === "none" ? "syncTargetRemoved" : "syncTargetSaved")}
        </Alert>
      )}
      {target?.source === "none" && !reloadRequired && (
        <section aria-label={t("syncTargetSetUp")}>
          <p>{t("syncTargetNone")}</p>
          {targetForm("syncTargetSetUp")}
          <p className="cloud-sync__note">{t("syncTargetWithout")}</p>
        </section>
      )}
      {login?.configured && !login.signedIn && (
        <Alert tone="info">
          <p>{t("backupSignInHint")}</p>
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
        </Alert>
      )}
      {status && (
        <>
          {!error && !busy && (
            <p className="cloud-sync__state" role="status">
              {t(stateLabels[status.state])}
            </p>
          )}
          <dl className="cloud-sync__facts">
            <dt>{t("target")}</dt>
            <dd>{status.endpoint || t("notConfigured")}</dd>
            {target?.source === "operator" && (
              <>
                <dt>{t("syncTargetOrigin")}</dt>
                <dd>{t("syncTargetOperator")}</dd>
              </>
            )}
            <dt>{t("cloudLastSync")}</dt>
            <dd>{status.lastSyncedAt ? date(status.lastSyncedAt) : t("noConfirmedTransfer")}</dd>
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
          {target && target.source !== "none" && !reloadRequired && (
            <Disclosure summary={t("syncTargetChange")}>{targetForm("syncTargetSave")}</Disclosure>
          )}
          {login?.signedIn && !reloadRequired && (
            <Disclosure summary={t("technicalDetails")}>
              <Button
                appearance="secondary"
                icon={<LogOut />}
                disabled={busy}
                onClick={() =>
                  // Signing out changes the account, not the project: nothing to save first.
                  void run(async () => {
                    await quiltorClient.application.backup.signOut();
                    await load();
                  }, false)
                }
              >
                {t("logout")}
              </Button>
            </Disclosure>
          )}
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
  );
  // Inside the tab the dialog would sit in the sheet, which a modal on top makes inert.
  const confirm = confirmation && (
    <ConfirmDialog
      title={t(confirmation === "keep-local" ? "cloudKeepLocal" : "cloudUseRemote")}
      description={t("cloudResolveConfirmation")}
      closeLabel={t("closeDialog")}
      confirmLabel={t("cloudConfirmResolution")}
      cancelLabel={t("cancel")}
      onConfirm={() => void synchronize(confirmation)}
      onClose={() => setConfirmation(null)}
    />
  );
  return (
    <>
      {embedded ? (
        <>
          {body}
          <div className="cloud-sync__footer">{footer}</div>
        </>
      ) : (
        <Dialog
          title={t("cloudTitle")}
          closeLabel={t("close")}
          onClose={() => {
            if (!busy && !reloadRequired) onClose();
          }}
          size="wide"
          footer={footer}
        >
          {body}
        </Dialog>
      )}
      {embedded && confirm ? createPortal(confirm, document.body) : confirm}
    </>
  );
}
