import { Bot, Database, Download, RotateCw } from "lucide-react";
import { Alert, Button, ProgressBar } from "../../design";
import { useI18n } from "../../i18n";
import {
  installAllowed,
  useInstanceCapabilities,
  useUserCapabilities,
} from "../../shared/capabilities";
import { installStepLabel } from "./installPhase";
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
  const capabilities = useInstanceCapabilities();
  // The capabilities say whether this account may use the server's assistant; the
  // status field is the fallback for an older server, and missing means allowed.
  const serverAi = useUserCapabilities().serverAi ?? status?.premium !== false;
  return (
    <>
      <div className="assistant-scope">
        <Database />
        <span>
          <strong>{t("sourcesIndexed").replace("{n}", String(status?.chunks ?? "…"))}</strong>
          <small>{t("sourcesScopeDescription")}</small>
        </span>
      </div>
      {/* Without the premium role nothing here can help: no model to reach, nothing to install
          (the install would answer 403). Only `false` counts -- older servers send no field. */}
      {status && !serverAi && (
        <Alert className="assistant-offline" tone="info" icon={<Bot />}>
          <p>{t("errorAssistantPremiumRequired")}</p>
        </Alert>
      )}
      {status && serverAi && !status.available && (
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
              label={installStepLabel(installState, t)}
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
          ) : !installAllowed(capabilities?.assistantInstall, status.installable) ? (
            <p className="assistant-offline-note">{t("assistantInstalledByOperator")}</p>
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
