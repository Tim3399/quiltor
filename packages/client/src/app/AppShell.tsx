import {
  ArchiveRestore,
  ArrowLeft,
  Download,
  HelpCircle,
  History,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
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
import { relativeTime, type SavePhase, type Theme, type Workspace } from "../shared";
import { useShortcut } from "./shell/useShortcut";
import "./AppShell.css";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";

const SAVE_STATUS_LABEL_KEYS: Record<SavePhase, MessageKey> = {
  idle: "ready",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "notSaved",
};

// A saved status ages while you read. The minute is the finest step relativeTime reports at
// all, so a tick at that resolution is enough -- and it runs only while there is a time to be
// seen in the first place.
//
// The clock is an external store read in whole ticks: the snapshot is the time it was first read
// in the current tick, so it is stable between ticks (as useSyncExternalStore requires) and a
// render that happens long after the last tick still sees the right time, without an effect to
// catch up. The timer is armed for the next tick boundary and runs only while `active`.
//
// The snapshot is that real time, not the tick boundary: from the boundary it would lag up to
// 30 s, and since relativeTime rounds down the bar would show a minute too little for that
// long. The reader starts afresh whenever the clock is switched on, so a saved state that
// appears mid-tick is measured from the moment it appears.
const TICK_MS = 30_000;
let clock = { tick: Number.NaN, now: 0 };
const readNow = () => {
  const now = Date.now();
  const tick = Math.floor(now / TICK_MS);
  if (tick !== clock.tick) clock = { tick, now };
  return clock.now;
};

function useMinuteTick(active: boolean) {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!active) return () => undefined;
      // React reads the snapshot again right after subscribing and renders the fresh time.
      clock = { tick: Number.NaN, now: 0 };
      let timer = 0;
      const arm = () => {
        timer = window.setTimeout(
          () => {
            onTick();
            arm();
          },
          TICK_MS - (Date.now() % TICK_MS),
        );
      };
      arm();
      return () => window.clearTimeout(timer);
    },
    [active],
  );
  return useSyncExternalStore(subscribe, readNow);
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
  errorId,
  warning,
  retry,
  signInRequired = false,
  onSignIn,
  onRecover,
  theme,
  onTheme,
  onSearch,
  onVersions,
  onExportProject,
  onGettingStarted,
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
  /** Server request id of the failed save, shown so the author can quote it. */
  errorId?: string;
  warning?: string;
  retry: () => void;
  /** The last save failed because the session ended (T-58 P7b). */
  signInRequired?: boolean;
  onSignIn?: () => void;
  onRecover?: () => void;
  theme: Theme;
  onTheme: () => void;
  navigationAvailable?: boolean;
  navigationOpen?: boolean;
  onNavigation?: () => void;
  onSearch: () => void;
  onVersions: () => void;
  onExportProject?: () => void;
  onGettingStarted?: () => void;
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
  // "Gespeichert" on its own does not answer whether the state is from a moment ago or from
  // earlier. Only after the first minute is there anything to say; until then the plain label
  // stands.
  const showSavedAgo = phase === "saved" && Boolean(savedAt);
  const now = useMinuteTick(showSavedAgo);
  const savedAgo = showSavedAgo && savedAt ? relativeTime(locale, savedAt, now) : null;
  const saveLabel = savedAgo ? t("savedAgo", { ago: savedAgo }) : t(SAVE_STATUS_LABEL_KEYS[phase]);
  return (
    <div className="app-frame" data-workspace={workspace}>
      <header className={`app-bar${phase === "error" ? " app-bar--save-error" : ""}`}>
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
            {phase === "error" && (
              <>
                <MenuItem icon={<Sparkles />} label={t("assistant")} onSelect={onAssistant} />
                <MenuItem icon={<Search />} label={t("search")} onSelect={onSearch} />
                <MenuSeparator />
              </>
            )}
            <MenuItem
              icon={<ArrowLeft />}
              label={t("returnToWorldSelection")}
              onSelect={onExitWorld}
            />
            <MenuSeparator />
            <MenuItem icon={<History />} label={t("versionsAndBackups")} onSelect={onVersions} />
            {onExportProject && (
              <MenuItem
                icon={<Download />}
                label={t("projectExportButton")}
                onSelect={onExportProject}
              />
            )}
            <MenuSeparator />
            {onGettingStarted && (
              <MenuItem
                icon={<HelpCircle />}
                label={t("gettingStartedTitle")}
                onSelect={onGettingStarted}
              />
            )}
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
            error={signInRequired ? t("saveSessionEnded") : error || warning}
            errorId={phase === "error" ? errorId : undefined}
            errorIdLabel={errorId ? t("saveErrorId", { id: errorId }) : undefined}
            retryLabel={t("retry")}
            onRetry={retry}
            signInLabel={signInRequired ? t("saveSignInNewTab") : undefined}
            onSignIn={signInRequired ? onSignIn : undefined}
          />
          {phase === "error" && onRecover && (
            <Button
              className="app-save-recovery"
              appearance="secondary"
              size="compact"
              icon={<ArchiveRestore />}
              aria-label={t("recoveryOpen")}
              onClick={onRecover}
            >
              <span className="app-save-recovery__label">{t("recoveryOpen")}</span>
            </Button>
          )}
        </div>
      </header>
      <main className="app-workspace">{children}</main>
      <StatusBar label={t("statusBar")} start={summary} />
    </div>
  );
}
