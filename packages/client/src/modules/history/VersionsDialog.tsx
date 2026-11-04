import { useCallback, useState } from "react";
import { Sheet, SheetHeader, Tab, TabList, TabPanel, Tabs } from "../../design";
import { useI18n } from "../../i18n";
import { BackupDialog } from "../backup";
import { CloudDialog } from "../cloud";
import type { Manuscript } from "../manuscript";
import "./VersionsDialog.css";
import { VersionsPanel } from "./VersionsPanel";

export type VersionsTab = "versions" | "backups" | "sync";

export type VersionsOpenOptions = {
  /** The tab to start on. `sync` falls back to `versions` where there is no sync tab. */
  tab?: VersionsTab;
  /** Put the cursor into the note field of the versions tab. */
  focusNote?: boolean;
};

/** The tab a dialog opened with `requested` actually starts on. */
export function startingVersionsTab(
  requested: VersionsTab | undefined,
  syncAvailable: boolean,
): VersionsTab {
  if (requested === "sync" && !syncAvailable) return "versions";
  return requested ?? "versions";
}

/**
 * One dialog for everything about earlier states of the project: the versions the author
 * holds on to, the automatic backups, and the sync with other devices. Each tab hosts the body
 * of the dialog it replaces.
 */
export function VersionsDialog({
  tab,
  focusNote = false,
  syncAvailable = true,
  onClose,
  flush,
  manuscript,
  onDocumentsReplaced,
}: VersionsOpenOptions & {
  /** Whether this installation syncs with other devices at all; an absent answer means yes. */
  syncAvailable?: boolean;
  onClose: () => void;
  flush: () => Promise<void>;
  manuscript: Manuscript;
  /** The server now holds other documents than the open workspace; nothing may save over them. */
  onDocumentsReplaced: () => void;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<VersionsTab>(() => startingVersionsTab(tab, syncAvailable));
  const [backupsBusy, setBackupsBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const busy = backupsBusy || syncBusy || versionsBusy;
  // A restore or a sync in flight must not be walked away from, and neither closed over.
  const guardedClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  return (
    <Sheet open label={t("versionsAndBackups")} onClose={guardedClose} wide>
      <div className="versions-dialog">
        <SheetHeader
          title={t("versionsAndBackups")}
          closeLabel={t("closeDialog")}
          onClose={guardedClose}
        />
        <Tabs
          className="versions-dialog__tabs"
          value={active}
          onValueChange={(value) => setActive(value as VersionsTab)}
          activationMode="manual"
        >
          <TabList label={t("versionsTabsLabel")} distribution="content">
            <Tab value="versions" disabled={busy && active !== "versions"}>
              {t("versionsTabVersions")}
            </Tab>
            <Tab value="backups" disabled={busy && active !== "backups"}>
              {t("versionsTabBackups")}
            </Tab>
            {syncAvailable && (
              <Tab value="sync" disabled={busy && active !== "sync"}>
                {t("versionsTabSync")}
              </Tab>
            )}
          </TabList>
          <TabPanel value="versions" className="versions-dialog__panel">
            {active === "versions" && (
              <VersionsPanel
                autoFocusNote={focusNote}
                flush={flush}
                onDocumentsReplaced={onDocumentsReplaced}
                onBusyChange={setVersionsBusy}
              />
            )}
          </TabPanel>
          <TabPanel value="backups" className="versions-dialog__panel">
            {active === "backups" && (
              <BackupDialog
                embedded
                onClose={onClose}
                flush={flush}
                onDocumentsReplaced={onDocumentsReplaced}
                onBusyChange={setBackupsBusy}
              />
            )}
          </TabPanel>
          {syncAvailable && (
            <TabPanel value="sync" className="versions-dialog__panel">
              {active === "sync" && (
                <div className="versions-dialog__pane">
                  <CloudDialog
                    embedded
                    onClose={onClose}
                    flush={flush}
                    manuscript={manuscript}
                    onDocumentsReplaced={onDocumentsReplaced}
                    onBusyChange={setSyncBusy}
                  />
                </div>
              )}
            </TabPanel>
          )}
        </Tabs>
      </div>
    </Sheet>
  );
}
