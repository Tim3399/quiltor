import { Cpu, Download, Trash2 } from "lucide-react";
import { type ComponentType, useEffect, useId, useSyncExternalStore } from "react";
import { Alert, Button, ProgressBar } from "../../../../design";
import { useI18n } from "../../../../i18n";
import type { ModelStore } from "./modelStore";
import "./WebllmPanel.css";

/**
 * The panel of the in-browser engine in the assistant's status view (T-61 part 7): whether the
 * model is on this device, its download with progress, and the button that removes it again.
 */
export function createWebllmPanel(store: ModelStore): ComponentType {
  return function WebllmPanel() {
    const { t } = useI18n();
    const progressId = useId();
    const state = useSyncExternalStore(store.subscribe, store.getState);
    useEffect(() => {
      void store.refresh();
    }, []);
    const download = () => void store.download().catch(() => {});
    const remove = () => void store.remove();
    const removeButton = (
      <Button size="compact" appearance="secondary" icon={<Trash2 />} onClick={remove}>
        {t("webllmRemoveModel")}
      </Button>
    );
    return (
      <Alert className="webllm-panel" tone="info" icon={<Cpu />} title={t("webllmTitle")}>
        {state.phase === "unknown" && <p>{t("webllmChecking")}</p>}
        {state.phase === "absent" && (
          <>
            <p>{t("webllmAbsent")}</p>
            <div className="webllm-panel-actions">
              <Button size="compact" icon={<Download />} onClick={download}>
                {t("webllmDownload")}
              </Button>
            </div>
          </>
        )}
        {state.phase === "downloading" && (
          <ProgressBar
            id={progressId}
            label={t("webllmDownloading")}
            value={Math.round(state.progress * 100)}
            valueLabel={`${Math.round(state.progress * 100)}%`}
            showValue
          />
        )}
        {state.phase === "cached" && (
          <>
            <p>{t("webllmCached")}</p>
            <div className="webllm-panel-actions">{removeButton}</div>
          </>
        )}
        {state.phase === "ready" && (
          <>
            <p>{t("webllmReady")}</p>
            <div className="webllm-panel-actions">{removeButton}</div>
          </>
        )}
        {state.phase === "error" && (
          <>
            <p>{t("webllmError", { error: state.message })}</p>
            <div className="webllm-panel-actions">
              <Button size="compact" icon={<Download />} onClick={download}>
                {t("webllmDownload")}
              </Button>
              {removeButton}
            </div>
          </>
        )}
      </Alert>
    );
  };
}
