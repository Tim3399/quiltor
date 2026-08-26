import { Bot, Database, Download, RotateCw } from "lucide-react";
import { Alert, Button, ProgressBar } from "../../design";
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
        <Alert
          className="assistant-offline"
          tone="warning"
          icon={<Bot />}
          title={t("localModelUnavailable")}
        >
          <p>{status.reason}</p>
          {installState?.running ? (
            <ProgressBar
              id={installProgressId}
              label={t("installingAssistant").replace("{percent}", String(installState.percent))}
              value={installState.percent}
              valueLabel={`${installState.percent}%`}
              showValue
            />
          ) : status.installed ? (
            <Button
              className="assistant-offline-action"
              size="compact"
              icon={<RotateCw />}
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          ) : (
            <Button
              className="assistant-offline-action"
              size="compact"
              icon={<Download />}
              onClick={onInstall}
            >
              {t("installAssistant")}
            </Button>
          )}
          {installState?.error && (
            <Alert className="assistant-offline-error" tone="danger">
              {t("installAssistantError").replace("{error}", installState.error)}
            </Alert>
          )}
        </Alert>
      )}
    </>
  );
}
