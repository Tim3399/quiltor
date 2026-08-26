import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, IconButton, Sheet } from "../../design";
import type { Translate } from "../../i18n";
import { useI18n } from "../../i18n";
import { applicationErrorMessage, quiltorClient } from "../../platform";
import { useFlushedEffect } from "../../shared/hooks/useFlushedEffect";
import type { SnapshotInfo } from "./model";
import { describePath, type PathKind } from "./pathNames";
import "./HistoryDialog.css";

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

export function HistoryDialog({
  onClose,
  flush,
}: {
  onClose: () => void;
  flush: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<SnapshotInfo[]>([]),
    [selected, setSelected] = useState("WORK"),
    [word, setWord] = useState(true),
    [all, setAll] = useState(false);
  const [result, setResult] = useState<{ diff: string; empty: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useFlushedEffect(flush, () =>
    quiltorClient.application.history.log().then((value) => setCommits(value.commits)),
  );
  useEffect(() => {
    setResult(null);
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
  }, [selected, word, all, t]);

  const segments = useMemo(
    () => (result?.diff ? parseDiff(result.diff, word) : []),
    [result, word],
  );
  useEffect(() => {
    setOpen(new Set(segments.length <= 2 ? segments.map((segment) => segment.path) : []));
  }, [segments]);
  const toggle = (path: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Sheet open label={t("history")} onClose={onClose} wide>
      <div className="utility-sheet">
        <header>
          <h2>{t("history")}</h2>
          <IconButton label={t("closeDialog")} icon={<X />} onClick={onClose} />
        </header>
        <div className="utility-sheet-content">
          <div className="history-toolbar">
            <span>{t("comparison")}</span>
            <div>
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
                  <strong>{t("sinceCommit")}</strong>
                  <small>{t("workingState")}</small>
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
                    <strong>{commit.subject}</strong>
                    <small>
                      {commit.shortHash} · {commit.date}
                    </small>
                  </span>
                </Button>
              ))}
            </nav>
            <div className="diff-view">
              {!result ? (
                <EmptyState headingLevel={3} role="status" size="compact" title={t("loading")} />
              ) : segments.length === 0 ? (
                <EmptyState
                  headingLevel={3}
                  size="compact"
                  title={result.empty || t("noChanges")}
                />
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
                      <section key={segment.path} className="diff-segment">
                        <h3>
                          {kindLabel(segment.kind, t)
                            ? `${kindLabel(segment.kind, t)} · ${segment.title}`
                            : segment.title}
                        </h3>
                        {segment.binary ? (
                          <p className="diff-note">{t("binaryChange")}</p>
                        ) : (
                          withOccurrenceKeys(segment.lines).map(({ key, value: line }) =>
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
                          )
                        )}
                      </section>
                    ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
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
