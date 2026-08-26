import type { ReactNode } from "react";
import { PRODUCT_MARK } from "../../config/branding";
import { PageState } from "../../design";
import { useI18n } from "../../i18n";
import { SignInGate } from "../../modules/identity";
import { WorldGate, type WorldInfo } from "../../modules/story-world";
import type { ThemePreference } from "../../shared";

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
  onCreate,
  onDelete,
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
  onCreate: (title: string, backupUrl: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();
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
        worlds={worlds}
        theme={theme}
        onTheme={onTheme}
        error={loadError}
        onOpen={onOpen}
        onCreate={onCreate}
        onDelete={onDelete}
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
