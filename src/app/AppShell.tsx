import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock3,
  DatabaseBackup,
  History,
  LogOut,
  MapPin,
  Save,
  Search,
  Sparkles,
  Users,
  FileText,
  Moon,
  Sun,
  MoreHorizontal,
  PanelLeft,
} from "lucide-react";
import type { Theme } from "../hooks/useTheme";
import type { SavePhase, Workspace } from "../types";
import { SaveStatus } from "../shared/ui/SaveStatus";
import { PRODUCT_NAME } from "../config/branding";
import { useLanguage } from "../language";
import { Menu, MenuItem, MenuSeparator } from "../shared/ui/Menu";
import { Popover } from "../shared/ui/Popover";
import { useShortcut } from "../shared/ui/shortcuts";

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
  whoami?: { email?: string; name?: string } | null;
  onLogout?: () => void;
  version?: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
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
            <button
              aria-pressed={navigationOpen}
              onClick={onNavigation}
              aria-label={t("toggleNavigation")}
              title={t("navigation")}
            >
              <PanelLeft />
            </button>
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
          <button
            aria-current={workspace === "text" ? "page" : undefined}
            onClick={() => onWorkspace("text")}
          >
            <FileText />
            {t("text")}
          </button>
          <button
            aria-current={workspace === "figures" ? "page" : undefined}
            onClick={() => onWorkspace("figures")}
          >
            <Users />
            {t("figures")}
          </button>
          <button
            aria-current={workspace === "timeline" ? "page" : undefined}
            onClick={() => onWorkspace("timeline")}
          >
            <Clock3 />
            {t("timeline")}
          </button>
          <button
            aria-current={workspace === "places" ? "page" : undefined}
            onClick={() => onWorkspace("places")}
          >
            <MapPin />
            {t("places")}
          </button>
        </nav>
        <div className="global-actions" role="toolbar" aria-label={t("globalTools")}>
          <button onClick={onAssistant} aria-label={t("openAssistant")} title={t("localAssistant")}>
            <Sparkles />
            <span>{t("assistant")}</span>
          </button>
          <button onClick={onSearch} aria-label={t("openSearch")} title={t("searchCommands")}>
            <Search />
            <span>{t("search")}</span>
            <kbd>{keys("K")}</kbd>
          </button>
          <button
            ref={overflowButton}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((value) => !value)}
            aria-label={t("menuMore")}
            title={t("menuMore")}
          >
            <MoreHorizontal />
          </button>
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
