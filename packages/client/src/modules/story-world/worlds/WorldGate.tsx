import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  FileText,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { BrandMark } from "../../../config/BrandMark";
import { PRODUCT_NAME } from "../../../config/branding";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  IconButton,
  IRREVERSIBLE_HOLD_MS,
  MenuItem,
  ScrollArea,
  SegmentedControl,
  SelectionCard,
  Sheet,
  TextField,
} from "../../../design";
import { availableLocales, useI18n } from "../../../i18n";
import type { ThemePreference } from "../../../shared";
import { ManuscriptImportDialog } from "../../manuscript-import";
import { ProjectImportDialog } from "../../project-transfer";
import type { WorldInfo } from "../model";
import "./WorldGate.css";

export function WorldGate({
  compact = false,
  worlds,
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
  theme,
  onTheme,
  error,
  syncAvailable = false,
}: {
  compact?: boolean;
  worlds: WorldInfo[];
  onOpen: (id: string) => Promise<void>;
  /** Opens a fresh preview of the example world in the interface language (D-127). */
  onOpenExample?: (lang: string) => Promise<void>;
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
  /** Offers the sync address field; a hosted server has no device sync (D-61). */
  syncAvailable?: boolean;
}) {
  const [title, setTitle] = useState(""),
    [backupUrl, setBackupUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorldInfo | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<WorldInfo | null>(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState<WorldInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importChoiceOpen, setImportChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [manuscriptImportOpen, setManuscriptImportOpen] = useState(false);
  const [worldQuery, setWorldQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
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
          {onOpenExample && (
            <DropdownMenu
              label={t("help")}
              open={helpOpen}
              onOpenChange={setHelpOpen}
              renderTrigger={({ ref, ...triggerProps }) => (
                <IconButton
                  {...triggerProps}
                  ref={ref}
                  className="world-help"
                  label={t("help")}
                  title={t("help")}
                  icon={<CircleHelp />}
                  appearance="ghost"
                  size="regular"
                />
              )}
            >
              <MenuItem
                icon={<BookOpen />}
                label={t("openExampleWorld")}
                onSelect={() => void run(() => onOpenExample(locale))}
              />
            </DropdownMenu>
          )}
        </div>
        <header>
          <span className="world-mark" aria-hidden="true">
            <BrandMark />
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
                <Button
                  icon={<Upload />}
                  labelOverflow={compact ? "wrap" : undefined}
                  onClick={() => setImportChoiceOpen(true)}
                >
                  {t("importChoiceButton")}
                </Button>
              )}
              {onLoadTrash && onRestore && onPurge && (
                <Button
                  icon={<Trash2 />}
                  labelOverflow={compact ? "wrap" : undefined}
                  onClick={() => {
                    setTrashOpen(true);
                    void onLoadTrash();
                  }}
                >
                  {t("trash")}
                </Button>
              )}
              <Button
                appearance="primary"
                icon={<Plus />}
                labelOverflow={compact ? "wrap" : undefined}
                onClick={() => setCreateOpen(true)}
              >
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
                  dashed={world.origin === "example"}
                  label={
                    world.origin === "example"
                      ? `${world.title} – ${t("exampleWorldLabel")} – ${t("openWorld")}`
                      : `${world.title} – ${t("openWorld")}`
                  }
                  title={world.title}
                  description={`${world.origin === "example" ? `${t("exampleWorldLabel")} · ` : ""}${t(
                    "lastChanged",
                  )} ${new Date(world.updated).toLocaleDateString(locale)}`}
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
            {!worlds.length && (
              <li className="world-list-empty">
                <p>{t("noWorld")}</p>
                {onOpenExample && (
                  <>
                    <Button
                      className="world-example-open"
                      icon={<BookOpen />}
                      disabled={busy}
                      onClick={() => void run(() => onOpenExample(locale))}
                    >
                      {t("openExampleWorld")}
                    </Button>
                    <p className="world-example-hint">{t("exampleWorldHint")}</p>
                  </>
                )}
              </li>
            )}
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
                  await onCreate(title.trim(), syncAvailable ? backupUrl.trim() : "");
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
            {syncAvailable && (
              <TextField
                id="world-backup-endpoint"
                label={t("backupEndpoint")}
                value={backupUrl}
                onChange={(event) => setBackupUrl(event.target.value)}
                placeholder={t("backupExample")}
                hint={t("backupRecommended")}
              />
            )}
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
      {importChoiceOpen && onProjectImported && (
        <Dialog
          open
          title={t("importChoiceTitle")}
          closeLabel={t("closeDialog")}
          onClose={() => setImportChoiceOpen(false)}
        >
          <ul className="world-import-choice">
            <li>
              <SelectionCard
                label={t("importChoiceManuscript")}
                title={t("importChoiceManuscript")}
                description={t("importChoiceManuscriptHelp")}
                descriptionLayout="wrap"
                leading={<FileText />}
                indicator={<ChevronRight />}
                onSelect={() => {
                  setImportChoiceOpen(false);
                  setManuscriptImportOpen(true);
                }}
              />
            </li>
            <li>
              <SelectionCard
                label={t("importChoiceProject")}
                title={t("importChoiceProject")}
                description={t("importChoiceProjectHelp")}
                descriptionLayout="wrap"
                leading={<Upload />}
                indicator={<ChevronRight />}
                onSelect={() => {
                  setImportChoiceOpen(false);
                  setImportOpen(true);
                }}
              />
            </li>
          </ul>
        </Dialog>
      )}
      {importOpen && onProjectImported && (
        <ProjectImportDialog onImported={onProjectImported} onClose={() => setImportOpen(false)} />
      )}
      {manuscriptImportOpen && onProjectImported && (
        <ManuscriptImportDialog
          onImported={onProjectImported}
          onClose={() => setManuscriptImportOpen(false)}
        />
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
