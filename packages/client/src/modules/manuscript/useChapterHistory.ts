import { useEffect, useState } from "react";
import { quiltorClient } from "../../platform";
import type { SnapshotInfo } from "../history";
import type { Chapter } from "./model";

export type ChapterHistoryState = "idle" | "loading" | "error";

export function useChapterHistory(current: Chapter | undefined, currentIndex: number) {
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<SnapshotInfo[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [historicalText, setHistoricalText] = useState("");
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
    if (!open || !selectedRef || !current) return;
    setState("loading");
    const timeout = setTimeout(() => {
      void quiltorClient.application.history
        .textVersion(selectedRef, currentIndex, current.title)
        .then((result) => {
          setHistoricalText(result.isNew ? "" : result.text);
          setState("idle");
        })
        .catch(() => setState("error"));
    }, 400);
    return () => clearTimeout(timeout);
  }, [open, selectedRef, current?.id, current?.title, currentIndex]);

  return {
    open,
    setOpen,
    commits,
    selectedRef,
    setSelectedRef,
    historicalText,
    state,
  };
}
