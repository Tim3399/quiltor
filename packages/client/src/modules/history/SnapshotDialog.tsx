import { useEffect, useState } from "react";
import { ChevronDown, LogIn, LogOut, Save, UploadCloud } from "lucide-react";
import { applicationErrorMessage, quiltorClient, type BackupLoginStatus } from "../../platform";
import type { BackupStatus } from "../backup";
import { Dialog } from "../../shared/ui/Dialog";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import { useI18n } from "../../i18n";
import { describePath, changedPath } from "./pathNames";
import "./SnapshotDialog.css";

// The login happens in another window and finishes there (the issuer redirects it
// back to /backup/callback, which redirects it to the app), so nothing calls back
// into this dialog -- it has to ask. Only while a login is actually out, and only
// for as long as a person plausibly spends on a login form.
const LOGIN_POLL_MS = 2000,
  LOGIN_POLL_LIMIT_MS = 180_000;
// While the backend still has its issuer lookup out it answers issuerReachable:
// null. Ask again rather than leaving the dialog undecided until someone reopens
// it. Bounded: the lookup behind it is itself bounded by two HTTP timeouts, so a
// handful of tries either learns the answer or has earned giving up on it.
const RECHECK_MS = 1500,
  RECHECK_TRIES = 8;

export function SnapshotDialog({
  onClose,
  flush,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null),
    [statusError, setStatusError] = useState(""),
    [message, setMessage] = useState(""),
    [output, setOutput] = useState(""),
    [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<BackupLoginStatus | null>(null),
    [loginError, setLoginError] = useState(""),
    [waiting, setWaiting] = useState(false),
    [rechecks, setRechecks] = useState(0);
  const loadLogin = () =>
    quiltorClient.application.backup
      .loginStatus()
      .then(setLogin)
      .catch((error) => setLoginError(applicationErrorMessage(error)));
  // Four states, four answers: no endpoint (nothing to sign in to), an endpoint
  // whose sign-in service has not answered yet (say so, decide nothing), one
  // that answered and is up (offer the login -- uploading now would be a 401),
  // and a login (upload). A hosted instance is signed in by its own session and
  // has no browser flow of its own -- see src/quiltor/delivery/http/routes/backup.py.
  // issuerReachable is three-valued: null means the backend's lookup is still
  // out. Reading that as "unreachable" would hide the sign-in button over a
  // question nobody has answered yet, so it gets its own state and a retry.
  const needsSignIn = !!login?.configured && !login.signedIn,
    canUpload = !!status?.endpoint && !!login?.signedIn;
  // A hosted instance has no browser flow of its own: its session is the
  // credential. So a hosted "not signed in" is not something to offer a login
  // for -- the session's token lapsed and could not be renewed, and the only
  // remedy is signing out of Quiltor itself and back in.
  const staleSession = needsSignIn && !!login.hosted;
  const checking =
    needsSignIn && !staleSession && login.issuerReachable == null && rechecks < RECHECK_TRIES;
  const canSignIn = needsSignIn && !staleSession && login.issuerReachable === true;
  useFlushedEffect(flush, () => {
    void loadLogin();
    return quiltorClient.application.backup
      .status()
      .then((value) => {
        setStatusError("");
        setStatus(value);
        setMessage(value.suggestedMessage);
      })
      .catch((error) => setStatusError(applicationErrorMessage(error)));
  });
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(
      () =>
        void quiltorClient.application.backup
          .loginStatus()
          .then((value) => {
            setLogin(value);
            if (value.signedIn) setWaiting(false);
          })
          .catch(() => undefined),
      LOGIN_POLL_MS,
    );
    const giveUp = setTimeout(() => setWaiting(false), LOGIN_POLL_LIMIT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [waiting]);
  useEffect(() => {
    if (!checking) return;
    const again = setTimeout(() => {
      setRechecks((count) => count + 1);
      void loadLogin();
    }, RECHECK_MS);
    return () => clearTimeout(again);
  }, [checking, login]);
  const send = async (upload: boolean) => {
    setBusy(true);
    setOutput("");
    try {
      await flush();
      const result = await quiltorClient.application.backup.saveSnapshot(message, upload);
      setOutput(result.log.join("\n") || t("done"));
      setStatus(result.status);
    } catch (error) {
      setOutput(applicationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const signIn = async () => {
    setBusy(true);
    setLoginError("");
    try {
      const result = await quiltorClient.application.backup.beginLogin();
      quiltorClient.platform.externalNavigation.open(result.authorizeUrl);
      setWaiting(true);
    } catch (error) {
      setLoginError(applicationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    setBusy(true);
    setLoginError("");
    setWaiting(false);
    try {
      await quiltorClient.application.backup.signOut();
      await loadLogin();
    } catch (error) {
      setLoginError(applicationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("snapshotSave")} onClose={onClose}>
      {statusError ? (
        <div className="error-box" role="alert">
          {statusError}
        </div>
      ) : !status ? (
        <p>{t("loadingBackupStatus")}</p>
      ) : (
        <>
          <label className="field">
            <span>{t("snapshotMessage")}</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          {needsSignIn &&
            (staleSession ? (
              <div className="error-box" role="alert">
                {t("backupSessionExpired")}
              </div>
            ) : checking ? (
              <p className="muted" role="status">
                {t("backupIssuerChecking")}
              </p>
            ) : canSignIn ? (
              <p className="muted">{t("backupSignInHint")}</p>
            ) : (
              <div className="error-box" role="alert">
                {t("backupIssuerUnreachable")}
              </div>
            ))}
          {waiting && (
            <p className="muted" role="status">
              {t("backupSignInWaiting")}
            </p>
          )}
          {loginError && (
            <div className="error-box" role="alert">
              {loginError}
            </div>
          )}
          <div className="dialog-actions">
            <button disabled={busy || !message.trim()} onClick={() => void send(false)}>
              <Save />
              {t("saveOnly")}
            </button>
            {canSignIn || checking ? (
              <button className="primary" disabled={busy || checking} onClick={() => void signIn()}>
                <LogIn />
                {t("backupSignIn")}
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !message.trim() || !canUpload}
                onClick={() => void send(true)}
              >
                <UploadCloud />
                {t("saveAndUpload")}
              </button>
            )}
          </div>
          {output && (
            <pre className="snapshot-output" role="status">
              {output}
            </pre>
          )}
          <details className="utility-disclosure">
            <summary>
              <ChevronDown />
              {t("technicalDetails")}
            </summary>
            <dl className="snapshot-facts">
              <div>
                <dt>{t("target")}</dt>
                <dd>{status.endpoint || t("notConfigured")}</dd>
              </div>
              {login?.signedIn && (
                <div>
                  <dt>{t("backupAccount")}</dt>
                  <dd>{login.email || login.name || login.account || t("backupSignedIn")}</dd>
                </div>
              )}
              <div>
                <dt>{t("changed")}</dt>
                <dd>
                  {status.changeCount} {t("files")}
                </dd>
              </div>
            </dl>
            {login?.signedIn && !login.hosted && (
              <button disabled={busy} onClick={() => void signOut()}>
                <LogOut />
                {t("logout")}
              </button>
            )}
            {!!status.changes.length && (
              <div className="changed-files">
                {status.changes.map((line) => {
                  const { kind, title } = describePath(changedPath(line));
                  const label =
                    kind === "chapter"
                      ? t("chapter")
                      : kind === "profile"
                        ? t("profile")
                        : kind === "database"
                          ? t("database")
                          : null;
                  return <code key={line}>{label ? `${label}: ${title}` : title}</code>;
                })}
              </div>
            )}
          </details>
        </>
      )}
    </Dialog>
  );
}
