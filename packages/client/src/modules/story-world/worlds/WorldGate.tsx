import { BookOpen, ChevronRight, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { PRODUCT_MARK, PRODUCT_NAME } from "../../../config/branding";
import {
  Alert,
  Button,
  ConfirmDialog,
  IconButton,
  IRREVERSIBLE_HOLD_MS,
  ScrollArea,
  SegmentedControl,
  SelectionCard,
  Sheet,
  TextField,
} from "../../../design";
import { availableLocales, useI18n } from "../../../i18n";
import type { ThemePreference } from "../../../shared";
import { ProjectImportDialog } from "../../project-transfer";
import type { WorldInfo } from "../model";
import "./WorldGate.css";

export function WorldGate({
  worlds,
  onOpen,
  onCreate,
  onDelete,
  trash,
  trashError,
  onLoadTrash,
  onRestore,
  onPurge,
  onProjectImported,
  theme,
  onTheme,
  error,
}: {
  worlds: WorldInfo[];
  onOpen: (id: string) => Promise<void>;
  onCreate: (title: string, backupUrl: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  trash?: (WorldInfo & { deletedAt: string })[] | null;
  trashError?: string;
  onLoadTrash?: () => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onPurge?: (id: string) => Promise<void>;
  onProjectImported?: (world: WorldInfo) => Promise<void>;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  error?: string;
}) {
  const [title, setTitle] = useState(""),
    [backupUrl, setBackupUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorldInfo | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<WorldInfo | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<WorldInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollArea as="main" axis="y" surface="canvas" className="world-gate">
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
          <Alert className="world-gate-error" tone="danger">
            {error}
          </Alert>
        )}
        {recentlyDeleted && onRestore && (
          <Alert
            className="world-trash-undo"
            tone="info"
            action={
              <Button
                disabled={busy}
                onClick={() => {
                  const target = recentlyDeleted;
                  void run(() => onRestore(target.id)).then((restored) => {
                    if (restored) setRecentlyDeleted(null);
                  });
                }}
              >
                {t("undoTrash")}
              </Button>
            }
          >
            {t("worldMovedToTrash").replace("{title}", recentlyDeleted.title)}
          </Alert>
        )}
        <div className="world-list-panel" data-long={worlds.length > 8 || undefined}>
          <header>
            <h2>{t("existingWorlds")}</h2>
            <div className="world-list-actions">
              {onProjectImported && (
                <Button icon={<Upload />} onClick={() => setImportOpen(true)}>
                  {t("projectImportButton")}
                </Button>
              )}
              {onLoadTrash && onRestore && onPurge && (
                <Button
                  icon={<Trash2 />}
                  onClick={() => {
                    setTrashOpen(true);
                    void onLoadTrash();
                  }}
                >
                  {t("trash")}
                </Button>
              )}
              <Button appearance="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>
                {t("newWorld")}
              </Button>
            </div>
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
          <ScrollArea
            as="ul"
            axis="y"
            surface="panel"
            className="world-list"
            data-long={worlds.length > 8 || undefined}
          >
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
          </ScrollArea>
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
      {importOpen && onProjectImported && (
        <ProjectImportDialog onImported={onProjectImported} onClose={() => setImportOpen(false)} />
      )}
      {trashOpen && onLoadTrash && onRestore && onPurge && (
        <Sheet open label={t("trashTitle")} onClose={() => setTrashOpen(false)}>
          <section className="world-trash-sheet">
            <header className="world-create-header">
              <h2>{t("trashTitle")}</h2>
              <IconButton
                label={t("close")}
                icon={<X />}
                size="regular"
                onClick={() => setTrashOpen(false)}
              />
            </header>
            {trashError && (
              <Alert
                tone="danger"
                action={
                  <Button disabled={busy} onClick={() => void run(onLoadTrash)}>
                    {t("retryTrash")}
                  </Button>
                }
              >
                {trashError}
              </Alert>
            )}
            {trash === null && (
              <p className="world-list-empty" role="status">
                {t("trashLoading")}
              </p>
            )}
            {trash !== undefined && trash !== null && !trash.length && !trashError && (
              <p className="world-list-empty">{t("trashEmpty")}</p>
            )}
            {trash && trash.length > 0 && (
              <ScrollArea as="ul" axis="y" surface="panel" className="world-list world-trash-list">
                {trash.map((world) => (
                  <li key={world.id} className="world-trash-item">
                    <div>
                      <h3 className="world-trash-title">{world.title}</h3>
                      <p className="world-trash-meta">
                        {t("deletedAt")} {new Date(world.deletedAt).toLocaleString(locale)}
                      </p>
                    </div>
                    <div className="world-trash-actions">
                      <Button
                        icon={<RotateCcw />}
                        disabled={busy}
                        onClick={() => {
                          void run(() => onRestore(world.id)).then((restored) => {
                            if (restored && recentlyDeleted?.id === world.id) {
                              setRecentlyDeleted(null);
                            }
                          });
                        }}
                      >
                        {t("restoreWorld")}
                      </Button>
                      <Button
                        icon={<Trash2 />}
                        tone="danger"
                        disabled={busy}
                        onClick={() => setPurgeTarget(world)}
                      >
                        {t("purgeWorld")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ScrollArea>
            )}
          </section>
        </Sheet>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={t("deleteWorldTitle")}
          description={t("deleteWorldDescription").replace("{title}", deleteTarget.title)}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("moveWorldToTrash")}
          onConfirm={() => {
            const target = deleteTarget;
            void run(() => onDelete(target.id)).then((deleted) => {
              if (deleted) setRecentlyDeleted(target);
            });
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {purgeTarget && onPurge && (
        <ConfirmDialog
          title={t("purgeWorldTitle")}
          description={t("purgeWorldDescription").replace("{title}", purgeTarget.title)}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("purgeWorld")}
          confirmation="hold"
          holdDurationMs={IRREVERSIBLE_HOLD_MS}
          holdLabels={{
            accessible: t("holdAriaLabel", { label: t("purgeWorld") }),
            idle: t("holdToConfirm", { label: t("purgeWorld") }),
            active: t("keepHolding"),
          }}
          onConfirm={() => {
            const target = purgeTarget;
            void run(() => onPurge(target.id)).then((purged) => {
              if (purged && recentlyDeleted?.id === target.id) setRecentlyDeleted(null);
            });
          }}
          onClose={() => setPurgeTarget(null)}
        />
      )}
    </ScrollArea>
  );
}
