import { Download } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Dialog } from "../../design";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import "./ProjectTransfer.css";

export function ProjectExportDialog({
  worldId,
  flush,
  onClose,
}: {
  worldId: string;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exportProject = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      const archive = await quiltorClient.application.projectTransfer.exportProject(worldId);
      const result = await quiltorClient.platform.files.save("Quiltor-Projekt.quiltor", archive);
      if (result.status === "saved") onClose();
      if (result.status === "failed") setError(result.error || t("projectExportFailed"));
    } catch (reason) {
      setError(applicationErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={t("projectExportTitle")} closeLabel={t("closeDialog")} onClose={onClose}>
      <div className="project-transfer-dialog">
        <p>{t("projectExportIntro")}</p>
        <p>{t("projectIncludesTrash")}</p>
        <p>{t("projectExcludesHistory")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="project-transfer-actions">
          <Button appearance="ghost" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            appearance="primary"
            icon={<Download />}
            loading={busy}
            loadingLabel={t("projectExporting")}
            onClick={() => void exportProject()}
          >
            {t("projectExportAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
