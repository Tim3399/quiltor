import { Archive, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  IRREVERSIBLE_HOLD_MS,
  Sheet,
  SheetBody,
  SheetHeader,
} from "../../design";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import "./BackupDialog.css";

export function BackupDialog({
  onClose,
  flush,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Array<{ name: string; created: string; size: number }>>([]),
    [selected, setSelected] = useState<string | null>(null),
    [restoreTarget, setRestoreTarget] = useState<string | null>(null),
    [error, setError] = useState("");
  useFlushedEffect(flush, () =>
    quiltorClient.application.backup
      .list()
      .then((result) => setItems(result.backups))
      .catch((reason) => setError(applicationErrorMessage(reason))),
  );
  const restore = async () => {
    if (!restoreTarget) return;
    try {
      await quiltorClient.application.backup.restore(restoreTarget);
      location.reload();
    } catch (reason) {
      setError(applicationErrorMessage(reason));
      setRestoreTarget(null);
    }
  };
  const selectedItem = items.find((item) => item.name === selected);
  return (
    <>
      <Sheet open label={t("backups")} onClose={onClose} wide>
        <div className="utility-sheet">
          <SheetHeader title={t("backups")} closeLabel={t("closeDialog")} onClose={onClose} />
          <SheetBody className="utility-sheet-content">
            <p className="muted">{t("backupAutoNote")}</p>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="utility-split backup-browser">
              <nav className="backup-list" aria-label={t("backups")}>
                {items.map((item) => (
                  <Button
                    key={item.name}
                    className="backup-list-item"
                    appearance="secondary"
                    icon={<Archive className="backup-list-item-icon" />}
                    aria-pressed={selected === item.name}
                    onClick={() => setSelected(item.name)}
                  >
                    <span className="backup-list-item-copy">
                      <strong>{new Date(item.created).toLocaleString()}</strong>
                      <small>{(item.size / 1024).toFixed(0)} KB</small>
                    </span>
                  </Button>
                ))}
                {!items.length && !error && (
                  <EmptyState title={t("noBackup")} size="compact" headingLevel={3} />
                )}
              </nav>
              <section className="backup-preview">
                {selectedItem ? (
                  <>
                    <Archive />
                    <h3>{new Date(selectedItem.created).toLocaleString()}</h3>
                    <p>
                      {t("backupPreviewDescription", {
                        size: `${(selectedItem.size / 1024).toFixed(0)} KB`,
                      })}
                    </p>
                    <Button
                      appearance="primary"
                      icon={<RotateCcw />}
                      onClick={() => setRestoreTarget(selectedItem.name)}
                    >
                      {t("restore")}
                    </Button>
                  </>
                ) : (
                  <EmptyState icon={<Archive />} title={t("backupSelectTitle")} headingLevel={3}>
                    <p>{t("backupSelectDescription")}</p>
                  </EmptyState>
                )}
              </section>
            </div>
          </SheetBody>
        </div>
      </Sheet>
      {restoreTarget && (
        <ConfirmDialog
          title={t("restoreBackup")}
          description={t("restoreConfirmDescription")}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("restore")}
          confirmation="hold"
          holdDurationMs={IRREVERSIBLE_HOLD_MS}
          holdLabels={{
            accessible: t("holdAriaLabel", { label: t("restore") }),
            idle: t("holdToConfirm", { label: t("restore") }),
            active: t("keepHolding"),
          }}
          onConfirm={() => void restore()}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </>
  );
}
