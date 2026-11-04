import { RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, ConfirmDialog, EmptyState, TextArea } from "../../design";
import type { Translate } from "../../i18n";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import type { SnapshotInfo } from "./model";
import { describePath, type PathKind } from "./pathNames";
import { snapshotName } from "./snapshotName";
import "./VersionsPanel.css";

interface DiffSegment {
  path: string;
  kind: PathKind;
  title: string;
  binary: boolean;
  lines: string[];
  added: number;
  removed: number;
}

// Diff plumbing lines (blob hashes, file-mode markers, hunk headers) -- an author cares
// which chapter changed and how, not this bookkeeping.
const NOISE_RE =
  /^(index |--- |\+\+\+ |old mode|new mode|deleted file mode|new file mode|similarity index|rename from|rename to|copy from|copy to)/;
const GAP_MARK = "⋯";

function wordsIn(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function segmentStats(lines: string[], word: boolean) {
  let added = 0,
    removed = 0;
  for (const line of lines) {
    if (!word) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
      continue;
    }
    for (const match of line.matchAll(/\{\+(.*?)\+\}/g)) added += wordsIn(match[1]);
    for (const match of line.matchAll(/\[-(.*?)-\]/g)) removed += wordsIn(match[1]);
    if (line.startsWith("+")) added += wordsIn(line.slice(1));
    else if (line.startsWith("-")) removed += wordsIn(line.slice(1));
  }
  return { added, removed };
}

function parseDiff(text: string, word: boolean): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let current: { path: string; lines: string[]; hunks: number } | null = null;
  const finish = () => {
    if (current) segments.push(buildSegment(current, word));
  };
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      finish();
      current = { path: header[2], lines: [], hunks: 0 };
      continue;
    }
    if (!current) continue;
    if (/^@@/.test(line)) {
      current.hunks++;
      if (current.hunks > 1) current.lines.push(GAP_MARK);
      continue;
    }
    if (NOISE_RE.test(line)) continue;
    current.lines.push(line);
  }
  finish();
  return segments;
}

function buildSegment(raw: { path: string; lines: string[] }, word: boolean): DiffSegment {
  const { kind, title } = describePath(raw.path);
  const binary = raw.lines.some((line) => line.startsWith("Binary files"));
  const lines = binary ? [] : raw.lines;
  const { added, removed } = binary ? { added: 0, removed: 0 } : segmentStats(lines, word);
  return { path: raw.path, kind, title, binary, lines, added, removed };
}

function kindLabel(kind: PathKind, t: Translate): string | null {
  if (kind === "chapter") return t("chapter");
  if (kind === "profile") return t("profile");
  if (kind === "database") return t("database");
  return null;
}

export function VersionsPanel({
  flush,
  autoFocusNote = false,
  onDocumentsReplaced,
  onBusyChange,
}: {
  flush: () => Promise<void>;
  /** Put the cursor into the note field once it is there (the "save a version" entry points). */
  autoFocusNote?: boolean;
  /** The server now holds other documents than the open workspace; nothing may save over them. */
  onDocumentsReplaced: () => void;
  /** Reports a running or just finished restore, so the host can keep the tab from changing. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [commits, setCommits] = useState<SnapshotInfo[]>([]),
    [selected, setSelected] = useState("WORK"),
    [word, setWord] = useState(true),
    [all, setAll] = useState(false);
  const [result, setResult] = useState<{ diff: string; empty: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  // What the server would call this version. Kept apart from the note: an empty note saves the
  // suggestion, so the author never edits server wording (T-85 turns it into a flag).
  const [suggestion, setSuggestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const restoreInFlight = useRef(false);
  const busy = restoring || restored;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const loadLog = async () => {
    const value = await quiltorClient.application.history.log();
    setCommits(value.commits);
    setReady(true);
    return value.commits;
  };
  useFlushedEffect(
    flush,
    async () => {
      await loadLog();
      // The suggestion is a convenience; without one an empty note cannot be saved.
      const status = await quiltorClient.application.backup.status().catch(() => null);
      if (status) setSuggestion(status.suggestedMessage);
    },
    (error) => setResult({ diff: "", empty: applicationErrorMessage(error) }),
  );
  // A new comparison drops the previous diff while it loads.
  const [comparison, setComparison] = useState({ selected, word, all, commits });
  if (
    comparison.selected !== selected ||
    comparison.word !== word ||
    comparison.all !== all ||
    comparison.commits !== commits
  ) {
    setComparison({ selected, word, all, commits });
    setResult(null);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: `commits` reruns the comparison after a save or a restore changed what a ref points at.
  useEffect(() => {
    if (!ready) return;
    void quiltorClient.application.history
      .diff(selected, word, all)
      .then((value) =>
        setResult({
          diff: value.diff,
          empty: value.diff
            ? ""
            : value.newFiles.length
              ? `${t("newFiles")}:\n${value.newFiles.join("\n")}`
              : t("noChanges"),
        }),
      )
      .catch((error) => setResult({ diff: "", empty: applicationErrorMessage(error) }));
  }, [selected, word, all, t, ready, commits]);

  const segments = useMemo(
    () => (result?.diff ? parseDiff(result.diff, word) : []),
    [result, word],
  );
  // Every newly parsed diff starts with its first segments expanded.
  const [openFor, setOpenFor] = useState(segments);
  if (openFor !== segments) {
    setOpenFor(segments);
    setOpen(new Set(segments.length <= 2 ? segments.map((segment) => segment.path) : []));
  }
  const toggle = (path: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Holding on to a version stays on this device: uploading belongs to the sync tab (D-57 F5).
  const holdVersion = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await flush();
      await quiltorClient.application.backup.saveSnapshot(note.trim(), false);
      const latest = await loadLog();
      if (latest[0]) setSelected(latest[0].hash);
      setNote("");
      setNotice({ tone: "success", text: t("versionHeld") });
    } catch (error) {
      setNotice({ tone: "danger", text: applicationErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    const target = restoreTarget;
    if (restoreInFlight.current || !target) return;
    restoreInFlight.current = true;
    setRestoring(true);
    setNotice(null);
    try {
      // A failed save must not be overwritten by the restore: nothing reaches the server then.
      await flush();
      await quiltorClient.application.history.restore(target.hash);
      onDocumentsReplaced();
      setRestoreTarget(null);
      setRestored(true);
      setSelected("WORK");
      setNotice({ tone: "success", text: t("versionRestored") });
      await loadLog().catch(() => undefined);
    } catch (error) {
      setNotice({ tone: "danger", text: applicationErrorMessage(error) });
      setRestoreTarget(null);
      restoreInFlight.current = false;
    } finally {
      setRestoring(false);
    }
  };

  const chosen = commits.find((commit) => commit.hash === selected);
  const confirm = restoreTarget && (
    <ConfirmDialog
      title={t("restoreVersionTitle")}
      description={t("restoreVersionDescription", {
        name: snapshotName(restoreTarget, t, locale),
      })}
      closeLabel={t("closeDialog")}
      cancelLabel={t("cancel")}
      confirmLabel={t("restoreVersionConfirm")}
      onConfirm={() => void restore()}
      onClose={() => {
        if (!restoreInFlight.current) setRestoreTarget(null);
      }}
    />
  );

  return (
    <div className="versions-tab">
      <section className="versions-tab__hold" aria-label={t("holdVersion")}>
        <TextArea
          label={t("snapshotMessage")}
          // The sheet claims focus after its children mounted; it hands it on to this mark.
          data-autofocus={autoFocusNote ? "" : undefined}
          value={note}
          placeholder={t("versionNotePlaceholder")}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="versions-tab__actions">
          <Button
            appearance="primary"
            disabled={saving || busy || !(note.trim() || suggestion)}
            icon={<Save />}
            onClick={() => void holdVersion()}
          >
            {t("holdVersion")}
          </Button>
        </div>
      </section>
      {notice && (
        <Alert tone={notice.tone} role="status">
          {notice.text}
          {restored && (
            <div className="versions-tab__actions">
              <Button appearance="primary" onClick={() => location.reload()}>
                {t("reloadAfterRestore")}
              </Button>
            </div>
          )}
        </Alert>
      )}
      <div className="history-toolbar">
        <span>{t("comparison")}</span>
        <div>
          {chosen && (
            <Button
              appearance="secondary"
              size="compact"
              icon={<RotateCcw />}
              disabled={busy}
              onClick={() => setRestoreTarget(chosen)}
            >
              {t("restoreVersion")}
            </Button>
          )}
          <Button
            appearance="secondary"
            size="compact"
            aria-pressed={word}
            onClick={() => setWord(!word)}
          >
            {word ? t("byWord") : t("byLine")}
          </Button>
          <Button
            appearance="secondary"
            size="compact"
            aria-pressed={all}
            onClick={() => setAll(!all)}
          >
            {all ? t("allFiles") : t("textOnly")}
          </Button>
        </div>
      </div>
      <div className="history-layout">
        <nav aria-label={t("states")}>
          <Button
            className="history-state-button"
            appearance="ghost"
            aria-pressed={selected === "WORK"}
            onClick={() => setSelected("WORK")}
          >
            <span className="history-state-copy">
              <strong>{t("currentState")}</strong>
              <small>{t("changesSinceLastVersion")}</small>
            </span>
          </Button>
          {commits.map((commit) => (
            <Button
              key={commit.hash}
              className="history-state-button"
              appearance="ghost"
              aria-pressed={selected === commit.hash}
              onClick={() => setSelected(commit.hash)}
            >
              <span className="history-state-copy">
                <strong>{snapshotName(commit, t, locale)}</strong>
                <small>{commit.shortHash}</small>
              </span>
            </Button>
          ))}
        </nav>
        <div className="diff-view">
          {!result ? (
            <EmptyState headingLevel={3} role="status" size="compact" title={t("loading")} />
          ) : segments.length === 0 ? (
            <EmptyState headingLevel={3} size="compact" title={result.empty || t("noChanges")} />
          ) : (
            <>
              <ul className="diff-summary">
                {segments.map((segment) => (
                  <li key={segment.path}>
                    <Button
                      className="diff-summary-button"
                      appearance="secondary"
                      size="compact"
                      aria-expanded={open.has(segment.path)}
                      onClick={() => toggle(segment.path)}
                    >
                      <span className="diff-summary-content">
                        {kindLabel(segment.kind, t) && (
                          <span className="diff-kind">{kindLabel(segment.kind, t)}</span>
                        )}
                        <span className="diff-summary-title">{segment.title}</span>
                        {!segment.binary && (
                          <span className="diff-stat">
                            {t(word ? "statWords" : "statLines", {
                              added: segment.added,
                              removed: segment.removed,
                            })}
                          </span>
                        )}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
              {segments
                .filter((segment) => open.has(segment.path))
                .map((segment) => (
                  <section key={segment.path} className="diff-segment" data-kind={segment.kind}>
                    <h3>
                      {kindLabel(segment.kind, t)
                        ? `${kindLabel(segment.kind, t)} · ${segment.title}`
                        : segment.title}
                    </h3>
                    {segment.binary ? (
                      <p className="diff-note">{t("binaryChange")}</p>
                    ) : (
                      <div className="diff-content">
                        {withOccurrenceKeys(segment.lines).map(({ key, value: line }) =>
                          line === GAP_MARK ? (
                            <div key={key} className="diff-gap">
                              {GAP_MARK}
                            </div>
                          ) : (
                            <div
                              key={key}
                              className={
                                line.startsWith("+")
                                  ? "diff-add"
                                  : line.startsWith("-")
                                    ? "diff-del"
                                    : ""
                              }
                            >
                              {word ? markWords(line) : line}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </section>
                ))}
            </>
          )}
        </div>
      </div>
      {/* Inside the sheet the dialog would be made inert with it (T-87 part 0): it goes to the body. */}
      {confirm && createPortal(confirm, document.body)}
    </div>
  );
}

function markWords(line: string) {
  return withOccurrenceKeys(line.split(/(\[-.*?-\]|\{\+.*?\+\})/g)).map(({ key, value: part }) =>
    part.startsWith("[-") ? (
      <del key={key}>{part.slice(2, -2)}</del>
    ) : part.startsWith("{+") ? (
      <ins key={key}>{part.slice(2, -2)}</ins>
    ) : (
      part
    ),
  );
}

function withOccurrenceKeys(values: string[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1;
    occurrences.set(value, occurrence);
    return { key: `${value}\u0000${occurrence}`, value };
  });
}
