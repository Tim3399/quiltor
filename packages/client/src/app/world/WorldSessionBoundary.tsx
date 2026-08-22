import type { ReactNode } from "react";
import { PRODUCT_MARK } from "../../config/branding";
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
    <main className="loading-state">
      <div className="loading-mark">{PRODUCT_MARK}</div>
      <p>{message}</p>
    </main>
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
      <main className="fatal-state">
        <h1>{t("unreachable")}</h1>
        <p>{loadError}</p>
        <p>
          {prefix}
          <code>python apps/web/server.py</code>
          {suffix}
        </p>
      </main>
    );
  }
  return ready ? children : loading(t("openingWorkshop"));
}
