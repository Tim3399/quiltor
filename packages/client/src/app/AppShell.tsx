import {
  ArrowLeft,
  DatabaseBackup,
  History,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Save,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "../config/branding";
import { Button, DropdownMenu, IconButton, MenuItem, MenuSeparator, SaveStatus } from "../design";
import { type MessageKey, useI18n } from "../i18n";
import type { SavePhase, Theme, Workspace } from "../shared";
import "./AppShell.css";
import { useShortcut } from "./shell/useShortcut";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";

const SAVE_STATUS_LABEL_KEYS: Record<SavePhase, MessageKey> = {
  idle: "ready",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "notSaved",
};

// Unterhalb von 400px reicht die App-Leiste nicht mehr fuer alles: Marke, drei 44px-Touchziele
// und der Speicherstand ergeben zusammen rund 398px. Der Speicherstand zieht deshalb dort ins
// ⋯-Menue um -- aber nur, solange er nichts Schlimmes zu melden hat, siehe unten.
function useNarrowBar() {
  const query = "(max-width: 399px)";
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query),
      change = () => setNarrow(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return narrow;
}

export function AppShell({
  title,
  workspace,
  onWorkspace,
  navigationAvailable = false,
  navigationOpen = false,
  onNavigation,
  phase,
  error,
  retry,
  theme,
  onTheme,
  onSearch,
  onHistory,
  onSnapshot,
  onBackups,
  onAssistant,
  onExitWorld,
  whoami,
  onLogout,
  version,
  children,
}: {
  title: string;
  workspace: Workspace;
  onWorkspace: (value: Workspace) => void;
  phase: SavePhase;
  error?: string;
  retry: () => void;
  theme: Theme;
  onTheme: () => void;
  navigationAvailable?: boolean;
  navigationOpen?: boolean;
  onNavigation?: () => void;
  onSearch: () => void;
  onHistory: () => void;
  onSnapshot: () => void;
  onBackups: () => void;
  onAssistant: () => void;
  onExitWorld: () => void;
  whoami?: { email?: string; name?: string } | null;
  onLogout?: () => void;
  version?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const keys = useShortcut();
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Ein fehlgeschlagenes Speichern bleibt in der Leiste, auch auf dem schmalsten Geraet. Der
  // Speicherstand ist keine Zierde -- er ist die einzige Auskunft darueber, ob der Text sicher
  // ist -- und hinter einem geschlossenen Menue waere ein Fehler unsichtbar. Die ruhigen
  // Zustaende duerfen umziehen, der Fehler nicht; er ist ausserdem der seltene Fall, in dem die
  // Leiste die 30px lieber wieder ausgibt.
  const narrowBar = useNarrowBar();
  const saveStatusInBar = !narrowBar || phase === "error";
  return (
    <div className="app-frame" data-workspace={workspace}>
      <header className="app-bar">
        <div className="app-bar__leading">
          {navigationAvailable && (
            <IconButton
              className="app-bar__navigation-action"
              label={t("toggleNavigation")}
              icon={<PanelLeft />}
              appearance="ghost"
              size="regular"
              aria-pressed={navigationOpen}
              onClick={onNavigation}
              title={t("navigation")}
            />
          )}
          <div
            className="brand"
            title={`${title} · ${PRODUCT_NAME}${version ? ` v${version}` : ""}`}
          >
            <span>{title}</span>
            <small>
              {PRODUCT_NAME}
              {version && ` · v${version}`}
            </small>
          </div>
        </div>
        <WorkspaceSwitcher value={workspace} onChange={onWorkspace} />
        <div className="global-actions" role="toolbar" aria-label={t("globalTools")}>
          <Button
            className="global-action"
            appearance="ghost"
            icon={<Sparkles />}
            onClick={onAssistant}
            aria-label={t("openAssistant")}
            title={t("localAssistant")}
          >
            <span className="global-action__content">{t("assistant")}</span>
          </Button>
          <Button
            className="global-action"
            appearance="ghost"
            icon={<Search />}
            onClick={onSearch}
            aria-label={t("openSearch")}
            title={t("searchCommands")}
          >
            <span className="global-action__content">
              {t("search")}
              <kbd>{keys("K")}</kbd>
            </span>
          </Button>
          <DropdownMenu
            label={t("menuActions")}
            open={overflowOpen}
            onOpenChange={setOverflowOpen}
            renderTrigger={({ ref, ...triggerProps }) => (
              <IconButton
                {...triggerProps}
                ref={ref}
                className="global-action global-action--icon"
                label={t("menuMore")}
                icon={<MoreHorizontal />}
                appearance="ghost"
                size="regular"
                title={t("menuMore")}
              />
            )}
          >
            {!saveStatusInBar && (
              <div className="menu-save-status">
                <SaveStatus
                  className="app-save-status"
                  phase={phase}
                  label={t(SAVE_STATUS_LABEL_KEYS[phase])}
                  error={error}
                  retryLabel={t("retry")}
                  onRetry={retry}
                />
              </div>
            )}
            {!saveStatusInBar && <MenuSeparator />}
            <MenuItem onSelect={onExitWorld}>
              <ArrowLeft />
              {t("returnToWorldSelection")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={onHistory}>
              <History />
              {t("history")}
            </MenuItem>
            <MenuItem onSelect={onBackups}>
              <DatabaseBackup />
              {t("backups")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={onSnapshot}>
              <Save />
              {t("snapshotSave")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={onTheme}>
              {theme === "dark" ? <Sun /> : <Moon />}
              {theme === "dark" ? t("themeLight") : t("themeDark")}
            </MenuItem>
            {whoami && onLogout && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={onLogout}>
                  <LogOut />
                  {t("logout")}
                </MenuItem>
              </>
            )}
          </DropdownMenu>
        </div>
        {saveStatusInBar && (
          <SaveStatus
            className="app-save-status"
            phase={phase}
            label={t(SAVE_STATUS_LABEL_KEYS[phase])}
            labelVisibility="attention"
            error={error}
            retryLabel={t("retry")}
            onRetry={retry}
          />
        )}
      </header>
      <main className="app-workspace">{children}</main>
    </div>
  );
}
