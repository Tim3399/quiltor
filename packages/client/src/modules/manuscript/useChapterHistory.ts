import { useEffect, useState } from "react";
import { quiltorClient } from "../../platform";
import type { SnapshotInfo } from "../history";
import type { Chapter } from "./model";

export type ChapterHistoryState = "idle" | "loading" | "error";

export function useChapterHistory(current: Chapter | undefined) {
  const currentId = current?.id;
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<SnapshotInfo[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [historicalText, setHistoricalText] = useState("");
  const [historicalExists, setHistoricalExists] = useState(false);
  const [previousHistoricalText, setPreviousHistoricalText] = useState("");
  const [comparisonAvailable, setComparisonAvailable] = useState(true);
  const [state, setState] = useState<ChapterHistoryState>("idle");

  useEffect(() => {
    if (!open || commits.length) return;
    setState("loading");
    void quiltorClient.application.history
      .log()
      .then((result) => {
        setCommits(result.commits);
        setSelectedRef(result.commits[0]?.hash || "");
        setState("idle");
      })
      .catch(() => setState("error"));
  }, [open, commits.length]);

  useEffect(() => {
    if (!open || !selectedRef || currentId === undefined) return;
    setState("loading");
    let cancelled = false;
    const timeout = setTimeout(() => {
      void quiltorClient.application.history
        .chapterComparison(selectedRef, currentId)
        .then((result) => {
          if (cancelled) return;
          if (!result.selected.available) throw new Error("Selected snapshot is unavailable");
          setHistoricalText(result.selected.text);
          setHistoricalExists(result.selected.exists);
          setPreviousHistoricalText(result.previous.text);
          setComparisonAvailable(result.previous.available);
          setState("idle");
        })
        .catch(() => {
          if (!cancelled) setState("error");
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, selectedRef, currentId]);

  return {
    open,
    setOpen,
    commits,
    selectedRef,
    setSelectedRef,
    historicalText,
    historicalExists,
    previousHistoricalText,
    comparisonAvailable,
    state,
  };
}
