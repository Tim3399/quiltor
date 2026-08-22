import { Bot, Database, Download, RotateCw } from "lucide-react";
import { useI18n } from "../../i18n";
import type { AssistantAvailability, AssistantInstallState } from "./useAssistantAvailability";
import "./AssistantStatusPanel.css";

export function AssistantStatusPanel({
  status,
  installState,
  installProgressId,
  onRetry,
  onInstall,
}: {
  status: AssistantAvailability | null;
  installState: AssistantInstallState | null;
  installProgressId: string;
  onRetry: () => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="assistant-scope">
        <Database />
        <span>
          <strong>{t("sourcesIndexed").replace("{n}", String(status?.chunks ?? "…"))}</strong>
          <small>{t("sourcesScopeDescription")}</small>
        </span>
      </div>
      {status && !status.available && (
        <div className="assistant-offline" role="alert">
          <Bot />
          <div>
            <strong>{t("localModelUnavailable")}</strong>
            <p>{status.reason}</p>
            {installState?.running ? (
              <div className="assistant-progress">
                <span id={installProgressId}>
                  {t("installingAssistant").replace("{percent}", String(installState.percent))}
                </span>
                <div
                  className="assistant-progress-bar"
                  role="progressbar"
                  aria-labelledby={installProgressId}
                  aria-valuenow={installState.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${installState.percent}%` }} />
                </div>
              </div>
            ) : status.installed ? (
              <button onClick={onRetry}>
                <RotateCw />
                {t("retry")}
              </button>
            ) : (
              <button onClick={onInstall}>
                <Download />
                {t("installAssistant")}
              </button>
            )}
            {installState?.error && (
              <p className="error-box" role="alert">
                {t("installAssistantError").replace("{error}", installState.error)}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
