import { Bot, Database, Download, RotateCw } from "lucide-react";
import { Alert, Button, ProgressBar, SegmentedControl } from "../../design";
import { useI18n } from "../../i18n";
import {
  installAllowed,
  useInstanceCapabilities,
  useUserCapabilities,
} from "../../shared/capabilities";
import type { AssistantEngineKind } from "./engines/types";
import { type EngineChoice, useEngineChoice } from "./engines/useEngineChoice";
import { installStepLabel } from "./installPhase";
import type { AssistantAvailability, AssistantInstallState } from "./useAssistantAvailability";
import "./AssistantStatusPanel.css";

export function AssistantStatusPanel({
  status,
  choice: shared,
  installState,
  installProgressId,
  onRetry,
  onInstall,
}: {
  status: AssistantAvailability | null;
  /** The drawer's engine choice; without one the panel keeps its own. */
  choice?: EngineChoice;
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
  const own = useEngineChoice(status?.premium !== false);
  const choice = shared ?? own;
  const onServer = choice.engine === "server";
  const EnginePanel = choice.slot?.Panel;
  const engineLabels: Record<AssistantEngineKind, string> = {
    server: t("assistantEngineServer"),
    webllm: t("assistantEngineBrowser"),
    cloud: t("assistantEngineOwnKey"),
  };
  return (
    <>
      {/* Only a real choice is shown: with the server alone nothing changes for the user. */}
      {choice.available.length > 1 && (
        <SegmentedControl
          className="assistant-engine-choice"
          size="compact"
          label={t("assistantEngineLabel")}
          value={choice.engine}
          options={choice.available.map((kind) => ({ value: kind, label: engineLabels[kind] }))}
          onChange={choice.choose}
        />
      )}
      {EnginePanel && <EnginePanel />}
      <div className="assistant-scope">
        <Database />
        <span>
          <strong>{t("sourcesIndexed").replace("{n}", String(status?.chunks ?? "…"))}</strong>
          <small>{t("sourcesScopeDescription")}</small>
        </span>
      </div>
      {/* Without the premium role nothing here can help: no model to reach, nothing to install
          (the install would answer 403). Only `false` counts -- older servers send no field. */}
      {onServer && status && !serverAi && (
        <Alert className="assistant-offline" tone="info" icon={<Bot />}>
          <p>{t("errorAssistantPremiumRequired")}</p>
        </Alert>
      )}
      {onServer && status && serverAi && !status.available && (
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
