import { BookOpen, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { PRODUCT_MARK, PRODUCT_NAME } from "../../../config/branding";
import { Button, IconButton, SelectionCard, TextField } from "../../../design";
import { availableLocales, useI18n } from "../../../i18n";
import type { ThemePreference } from "../../../shared";
import { ConfirmDialog, IRREVERSIBLE_HOLD_MS } from "../../../shared/ui/ConfirmDialog";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Sheet } from "../../../shared/ui/Sheet";
import type { WorldInfo } from "../model";
import "./WorldGate.css";

export function WorldGate({
  worlds,
  onOpen,
  onCreate,
  onDelete,
  theme,
  onTheme,
  error,
}: {
  worlds: WorldInfo[];
  onOpen: (id: string) => Promise<void>;
  onCreate: (title: string, backupUrl: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  error?: string;
}) {
  const [title, setTitle] = useState(""),
    [backupUrl, setBackupUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorldInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [worldQuery, setWorldQuery] = useState("");
  const { locale, setLocale, t } = useI18n();
  const normalizedQuery = worldQuery.trim().toLocaleLowerCase(locale);
  const visibleWorlds = normalizedQuery
    ? worlds.filter((world) => world.title.toLocaleLowerCase(locale).includes(normalizedQuery))
    : worlds;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="world-gate">
      <section>
        <div className="gate-preferences">
          <SegmentedControl
            label={t("themeChoice")}
            value={theme}
            onChange={onTheme}
            options={[
              { value: "system", label: t("themeSystem") },
              { value: "light", label: t("themeLight") },
              { value: "dark", label: t("themeDark") },
            ]}
          />
          <SegmentedControl
            label={t("languageChoice")}
            value={locale}
            onChange={setLocale}
            options={availableLocales.map((candidate) => ({
              value: candidate.locale,
              label: candidate.name,
            }))}
          />
        </div>
        <header>
          <span className="world-mark" aria-hidden="true">
            {PRODUCT_MARK}
          </span>
          <div>
            <small>
              {PRODUCT_NAME} · {t("authorWorkshop")}
            </small>
            <h1>{t("openWorld")}</h1>
            <p>{t("worldIntro")}</p>
          </div>
        </header>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="world-list-panel">
          <header>
            <h2>{t("existingWorlds")}</h2>
            <Button appearance="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>
              {t("newWorld")}
            </Button>
          </header>
          {worlds.length > 8 && (
            <TextField
              id="world-search"
              fieldClassName="world-filter"
              type="search"
              label={t("search")}
              placeholder={t("searchTerm")}
              value={worldQuery}
              onChange={(event) => setWorldQuery(event.target.value)}
            />
          )}
          <ul className="world-list" data-long={worlds.length > 8 || undefined}>
            {visibleWorlds.map((world) => (
              <li key={world.id}>
                <SelectionCard
                  label={`${world.title} – ${t("openWorld")}`}
                  title={world.title}
                  description={`${t("lastChanged")} ${new Date(world.updated).toLocaleDateString(
                    locale,
                  )}`}
                  leading={<BookOpen />}
                  indicator={<ChevronRight />}
                  disabled={busy}
                  onSelect={() => void run(() => onOpen(world.id))}
                  actionsLabel={`${world.title} – ${t("menuActions")}`}
                  actions={
                    <IconButton
                      disabled={busy}
                      tone="danger"
                      size="regular"
                      label={`${world.title} – ${t("deleteWorld")}`}
                      icon={<Trash2 />}
                      title={t("deleteWorld")}
                      onClick={() => setDeleteTarget(world)}
                    />
                  }
                />
              </li>
            ))}
            {!worlds.length && <li className="world-list-empty">{t("noWorld")}</li>}
            {Boolean(worlds.length && !visibleWorlds.length) && (
              <li className="world-list-empty" role="status">
                {t("writingNoResults")}
              </li>
            )}
          </ul>
        </div>
      </section>
      {createOpen && (
        <Sheet open label={t("newWorld")} onClose={() => setCreateOpen(false)}>
          <form
            className="world-create-sheet"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim())
                void run(async () => {
                  await onCreate(title.trim(), backupUrl.trim());
                  setCreateOpen(false);
                });
            }}
          >
            <header className="world-create-header">
              <h2>{t("newWorld")}</h2>
              <IconButton
                label={t("close")}
                icon={<X />}
                size="regular"
                onClick={() => setCreateOpen(false)}
              />
            </header>
            <p>{t("newWorldIntro")}</p>
            <TextField
              id="world-title"
              data-autofocus
              label={t("worldTitle")}
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("worldExample")}
            />
            <TextField
              id="world-backup-endpoint"
              label={t("backupEndpoint")}
              value={backupUrl}
              onChange={(event) => setBackupUrl(event.target.value)}
              placeholder={t("backupExample")}
              hint={t("backupRecommended")}
            />
            <div className="world-create-actions">
              <Button
                type="submit"
                appearance="primary"
                icon={<Plus />}
                loading={busy}
                loadingLabel={t("createWorld")}
                disabled={!title.trim()}
              >
                {t("createWorld")}
              </Button>
            </div>
          </form>
        </Sheet>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={t("deleteWorldTitle")}
          description={t("deleteWorldDescription").replace("{title}", deleteTarget.title)}
          confirmLabel={t("deleteWorld")}
          holdDurationMs={IRREVERSIBLE_HOLD_MS}
          onConfirm={() => void run(() => onDelete(deleteTarget.id))}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </main>
  );
}
