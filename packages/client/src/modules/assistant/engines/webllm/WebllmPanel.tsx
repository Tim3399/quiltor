import { Cpu, Download, Ellipsis, Trash2 } from "lucide-react";
import { type ComponentType, useEffect, useId, useSyncExternalStore } from "react";
import { Alert, Button, DropdownMenu, IconButton, MenuItem, ProgressBar } from "../../../../design";
import { useI18n } from "../../../../i18n";
import type { ModelStore } from "./modelStore";
import "./WebllmPanel.css";

/**
 * The panel of the in-browser engine in the assistant's status view (T-61 part 7): whether the
 * model is on this device, its download with progress, and the button that removes it again.
 * A loaded model asks nothing of the author, so it is only a quiet status line with its removal
 * in an overflow menu (T-275-F6); only states that need action keep the alert.
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
    if (state.phase === "ready") {
      const label = t("webllmModelActions");
      return (
        <div className="webllm-status">
          <Cpu aria-hidden="true" />
          <span title={t("webllmReady")}>{t("webllmReadyStatus")}</span>
          <DropdownMenu
            label={label}
            renderTrigger={({ ref, ...triggerProps }) => (
              <IconButton
                {...triggerProps}
                ref={ref}
                size="compact"
                icon={<Ellipsis />}
                label={label}
                title={label}
              />
            )}
          >
            <MenuItem
              icon={<Trash2 />}
              label={t("webllmRemoveModel")}
              tone="danger"
              onSelect={remove}
            />
          </DropdownMenu>
        </div>
      );
    }
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
