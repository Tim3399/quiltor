import type { ReactNode } from "react";
import { PRODUCT_MARK } from "../../config/branding";
import { PageState } from "../../design";
import { useI18n } from "../../i18n";
import { SignInGate } from "../../modules/identity";
import { WorldGate, type WorldInfo } from "../../modules/story-world";
import type { ThemePreference } from "../../shared";
import { useViewportMode } from "../workspace/useWorkspaceLayout";

export function WorldSessionBoundary({
  worlds,
  world,
  needsSignIn,
  authError,
  loadError,
  ready,
  theme,
  onTheme,
  onOpen,
  onOpenExample,
  onCreate,
  onDelete,
  trash,
  trashError,
  onLoadTrash,
  onRestore,
  onPurge,
  onProjectImported,
  syncAvailable = false,
  children,
}: {
  worlds: WorldInfo[] | null;
  world: WorldInfo | null;
  needsSignIn: boolean;
  authError: string | null;
  loadError: string;
  ready: boolean;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  onOpen: (id: string) => Promise<void>;
  onOpenExample?: (lang: string) => Promise<void>;
  onCreate: (title: string, backupUrl: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  trash: (WorldInfo & { deletedAt: string })[] | null;
  trashError: string;
  onLoadTrash: () => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onPurge: (id: string) => Promise<void>;
  onProjectImported?: (world: WorldInfo) => Promise<void>;
  /** Offers the sync address when creating a world; false on a hosted server (D-61). */
  syncAvailable?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const viewportMode = useViewportMode();
  const loading = (message: string) => (
    <PageState kind="loading" mark={PRODUCT_MARK}>
      <p>{message}</p>
    </PageState>
  );

  if (needsSignIn) return <SignInGate authError={authError} />;
  if (worlds === null) return loading(t("loadingWorlds"));
  if (!world)
    return (
      <WorldGate
        compact={viewportMode === "compact"}
        worlds={worlds}
        theme={theme}
        onTheme={onTheme}
        error={loadError}
        onOpen={onOpen}
        onOpenExample={onOpenExample}
        onCreate={onCreate}
        onDelete={onDelete}
        trash={trash}
        trashError={trashError}
        onLoadTrash={onLoadTrash}
        onRestore={onRestore}
        onPurge={onPurge}
        onProjectImported={onProjectImported}
        syncAvailable={syncAvailable}
      />
    );
  if (loadError) {
    const [prefix, suffix] = t("restartServerHint").split("{code}");
    return (
      <PageState kind="error" title={t("unreachable")}>
        <p>{loadError}</p>
        <p>
          {prefix}
          <code>python apps/web/server.py</code>
          {suffix}
        </p>
      </PageState>
    );
  }
  return ready ? children : loading(t("openingWorkshop"));
}
