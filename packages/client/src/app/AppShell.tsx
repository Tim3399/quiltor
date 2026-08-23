import {
  ArrowLeft,
  Clock3,
  DatabaseBackup,
  FileText,
  History,
  LogOut,
  MapPin,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Save,
  Search,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCT_NAME } from "../config/branding";
import { Button, IconButton } from "../design";
import { useI18n } from "../i18n";
import type { SavePhase, Theme, Workspace } from "../shared";
import { Menu, MenuItem, MenuSeparator } from "../shared/ui/Menu";
import { Popover } from "../shared/ui/Popover";
import { SaveStatus } from "../shared/ui/SaveStatus";
import { useShortcut } from "../shared/ui/shortcuts";
import "./AppShell.css";

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
  const overflowButton = useRef<HTMLButtonElement>(null);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);
  const runOverflow = (action: () => void) => {
    setOverflowOpen(false);
    action();
  };
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
        <nav className="workspace-switch" aria-label={t("workspaceNav")}>
          <Button
            className="app-bar__workspace-button"
            appearance="ghost"
            icon={<FileText />}
            aria-label={t("text")}
            aria-current={workspace === "text" ? "page" : undefined}
            onClick={() => onWorkspace("text")}
          >
            {t("text")}
          </Button>
          <Button
            className="app-bar__workspace-button"
            appearance="ghost"
            icon={<Users />}
            aria-label={t("figures")}
            aria-current={workspace === "figures" ? "page" : undefined}
            onClick={() => onWorkspace("figures")}
          >
            {t("figures")}
          </Button>
          <Button
            className="app-bar__workspace-button"
            appearance="ghost"
            icon={<Clock3 />}
            aria-label={t("timeline")}
            aria-current={workspace === "timeline" ? "page" : undefined}
            onClick={() => onWorkspace("timeline")}
          >
            {t("timeline")}
          </Button>
          <Button
            className="app-bar__workspace-button"
            appearance="ghost"
            icon={<MapPin />}
            aria-label={t("places")}
            aria-current={workspace === "places" ? "page" : undefined}
            onClick={() => onWorkspace("places")}
          >
            {t("places")}
          </Button>
        </nav>
        <div className="global-actions" role="toolbar" aria-label={t("globalTools")}>
          <Button
            appearance="ghost"
            icon={<Sparkles />}
            onClick={onAssistant}
            aria-label={t("openAssistant")}
            title={t("localAssistant")}
          >
            {t("assistant")}
          </Button>
          <Button
            appearance="ghost"
            icon={<Search />}
            onClick={onSearch}
            aria-label={t("openSearch")}
            title={t("searchCommands")}
          >
            {t("search")}
            <kbd>{keys("K")}</kbd>
          </Button>
          <IconButton
            ref={overflowButton}
            label={t("menuMore")}
            icon={<MoreHorizontal />}
            appearance="ghost"
            size="regular"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((value) => !value)}
            title={t("menuMore")}
          />
        </div>
        {saveStatusInBar && <SaveStatus phase={phase} error={error} onRetry={retry} />}
        <Popover
          anchorRef={overflowButton}
          open={overflowOpen}
          onClose={closeOverflow}
          label={t("menuActions")}
        >
          <Menu label={t("menuActions")} onClose={closeOverflow}>
            {!saveStatusInBar && (
              <div className="menu-save-status">
                <SaveStatus phase={phase} error={error} onRetry={retry} />
              </div>
            )}
            {!saveStatusInBar && <MenuSeparator />}
            <MenuItem onSelect={() => runOverflow(onExitWorld)}>
              <ArrowLeft />
              {t("returnToWorldSelection")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => runOverflow(onHistory)}>
              <History />
              {t("history")}
            </MenuItem>
            <MenuItem onSelect={() => runOverflow(onBackups)}>
              <DatabaseBackup />
              {t("backups")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => runOverflow(onSnapshot)}>
              <Save />
              {t("snapshotSave")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => runOverflow(onTheme)}>
              {theme === "dark" ? <Sun /> : <Moon />}
              {theme === "dark" ? t("themeLight") : t("themeDark")}
            </MenuItem>
            {whoami && onLogout && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => runOverflow(onLogout)}>
                  <LogOut />
                  {t("logout")}
                </MenuItem>
              </>
            )}
          </Menu>
        </Popover>
      </header>
      <main className="workspace">{children}</main>
    </div>
  );
}
