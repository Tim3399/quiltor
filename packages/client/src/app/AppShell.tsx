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
import {
  Button,
  DropdownMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  SaveStatus,
  StatusBar,
} from "../design";
import { type MessageKey, useI18n } from "../i18n";
import { relativeTime, type SavePhase, type Theme, useShortcut, type Workspace } from "../shared";
import "./AppShell.css";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";

const SAVE_STATUS_LABEL_KEYS: Record<SavePhase, MessageKey> = {
  idle: "ready",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "notSaved",
};

// Ein gespeicherter Stand altert waehrend man liest. Die Minute ist die feinste Stufe, die
// relativeTime ueberhaupt ausgibt, deshalb reicht ein Tick in dieser Aufloesung -- und er laeuft
// nur, solange ueberhaupt eine Zeitangabe zu sehen ist.
function useMinuteTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}

export function AppShell({
  title,
  workspace,
  onWorkspace,
  navigationAvailable = false,
  navigationOpen = false,
  onNavigation,
  phase,
  savedAt,
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
  summary,
  children,
}: {
  title: string;
  workspace: Workspace;
  onWorkspace: (value: Workspace) => void;
  phase: SavePhase;
  savedAt?: number | null;
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
  /** What is open in the active workspace: counts and position for the status bar. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const keys = useShortcut();
  const [overflowOpen, setOverflowOpen] = useState(false);
  // "Gespeichert" allein beantwortet nicht, ob der Stand von eben oder von vorhin ist. Erst
  // nach der ersten Minute gibt es etwas zu sagen; davor bleibt das schlichte Label stehen.
  const showSavedAgo = phase === "saved" && Boolean(savedAt);
  const now = useMinuteTick(showSavedAgo);
  const savedAgo = showSavedAgo && savedAt ? relativeTime(locale, savedAt, now) : null;
  const saveLabel = savedAgo ? t("savedAgo", { ago: savedAgo }) : t(SAVE_STATUS_LABEL_KEYS[phase]);
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
            <small>{PRODUCT_NAME}</small>
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
            footer={
              version ? (
                <span className="app-menu-version">
                  {PRODUCT_NAME} v{version}
                </span>
              ) : undefined
            }
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
            <MenuItem
              icon={<ArrowLeft />}
              label={t("returnToWorldSelection")}
              onSelect={onExitWorld}
            />
            <MenuSeparator />
            <MenuItem icon={<History />} label={t("history")} onSelect={onHistory} />
            <MenuItem icon={<DatabaseBackup />} label={t("backups")} onSelect={onBackups} />
            <MenuSeparator />
            <MenuItem icon={<Save />} label={t("snapshotSave")} onSelect={onSnapshot} />
            <MenuSeparator />
            <MenuItem
              icon={theme === "dark" ? <Sun /> : <Moon />}
              label={theme === "dark" ? t("themeLight") : t("themeDark")}
              onSelect={onTheme}
            />
            {whoami && onLogout && (
              <>
                <MenuSeparator />
                <MenuItem icon={<LogOut />} label={t("logout")} onSelect={onLogout} />
              </>
            )}
          </DropdownMenu>
          <SaveStatus
            className="app-save-status"
            phase={phase}
            label={saveLabel}
            error={error}
            retryLabel={t("retry")}
            onRetry={retry}
          />
        </div>
      </header>
      <main className="app-workspace">{children}</main>
      <StatusBar label={t("statusBar")} start={summary} />
    </div>
  );
}
