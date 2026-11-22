import { Bot, Database, Download, RotateCw } from "lucide-react";
import { useId } from "react";
import { Alert, Button, ProgressBar, SegmentedControl } from "../../design";
import { useI18n } from "../../i18n";
import {
  installAllowed,
  useInstanceCapabilities,
  useUserCapabilities,
} from "../../shared/capabilities";
import { type EngineChoice, useEngineChoice } from "./engines/useEngineChoice";
import { useEngineLabels } from "./engines/useEngineLabels";
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
  const engineLabels = useEngineLabels();
  // Without the premium role the server AI stays in the switch, greyed out, and a note says
  // why; the switch is described by it, so keyboard and screen reader reach the reason too
  // (T-275 Nachtrag 3, D-T-61-8a-F2). Only a hosted server has a role to lack; on a computer
  // of one's own the server engine is always on offer. That holds with no other engine as well,
  // where the greyed-out switch is all there is (D-T-275-F1).
  // An older server sends no capabilities: then the premium alert below says it instead.
  const hosted = capabilities?.assistantInstall === false;
  const serverLocked = hosted && !serverAi && !choice.available.includes("server");
  const lockNote = useId();
  const browserNote = useId();
  const described =
    [serverLocked && lockNote, choice.browserUnsupported && browserNote]
      .filter(Boolean)
      .join(" ") || undefined;
  const options = [
    ...(serverLocked
      ? [
          {
            value: "server" as const,
            label: engineLabels.server,
            disabled: true,
            // The reason is a tooltip on the greyed-out option, not a standing note; it still
            // describes the whole switch for screen readers (T-275-F6).
            hint: t("assistantEngineServerLocked"),
            hintId: lockNote,
          },
        ]
      : []),
    ...choice.available.map((kind) => ({ value: kind, label: engineLabels[kind] })),
    // The chosen browser engine stays in the switch although this browser cannot run it.
    ...(choice.blocked ? [{ value: "webllm" as const, label: engineLabels.webllm }] : []),
  ];
  return (
    <>
      {/* Only a real choice is shown: with the server alone nothing changes for the user.
          Before the capabilities arrive no other engine is offered, so no switch can name the
          server engine too early (D-T-275-F3). */}
      {(options.length > 1 || serverLocked || choice.browserUnsupported) && (
        <div className="assistant-engine">
          {(options.length > 1 || serverLocked) && (
            <SegmentedControl
              className="assistant-engine-choice"
              size="compact"
              aria-describedby={described}
              label={t("assistantEngineLabel")}
              value={choice.engine}
              options={options}
              onChange={choice.choose}
            />
          )}
          {choice.browserUnsupported && (
            <small id={browserNote} className="assistant-engine-note">
              {t("assistantEngineBrowserUnsupported")}
            </small>
          )}
        </div>
      )}
      {/* No model download where the model cannot run: the note above says why (F-275-2). */}
      {EnginePanel && !choice.blocked && <EnginePanel />}
      <div className="assistant-scope">
        <Database />
        <span>
          <strong>{t("sourcesIndexed").replace("{n}", String(status?.chunks ?? "…"))}</strong>
          <small>{t("sourcesScopeDescription")}</small>
        </span>
      </div>
      {/* Without the premium role nothing here can help: no model to reach, nothing to install
          (the install would answer 403). Only `false` counts -- older servers send no field. */}
      {/* The note at the switch already says it when the switch shows the server greyed out. */}
      {onServer && status && !serverAi && !serverLocked && (
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
