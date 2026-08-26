import { ArrowDown, ArrowUp } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "../../design";
import { useI18n } from "../../i18n";

export interface ChapterTurnTarget {
  id: string;
  number: number;
  title: string;
}

export function ChapterTurnAffordance({
  direction,
  target,
  progress,
  active,
  onNavigate,
}: {
  direction: "previous" | "next";
  target: ChapterTurnTarget;
  progress: number;
  active: boolean;
  onNavigate: () => void;
}) {
  const { t } = useI18n();
  const directionLabel = t(direction === "previous" ? "previousChapter" : "nextChapter");
  const targetLabel = t("chapterTurnTarget", {
    number: target.number,
    title: target.title || t("untitled"),
  });

  return (
    <div
      className={`chapter-turn chapter-turn--${direction}`}
      data-active={active || undefined}
      style={{ "--chapter-turn-progress": Math.max(0, Math.min(1, progress)) } as CSSProperties}
    >
      <Button
        appearance="secondary"
        size="touch"
        className="chapter-turn__action"
        icon={direction === "previous" ? <ArrowUp /> : <ArrowDown />}
        aria-label={`${directionLabel}: ${targetLabel}`}
        data-target-chapter-id={target.id}
        onClick={onNavigate}
      >
        <span className="chapter-turn__copy">
          <span>{directionLabel}</span>
          <strong>{targetLabel}</strong>
          <small>{t("chapterTurnHint")}</small>
        </span>
        <span className="chapter-turn__progress" aria-hidden="true">
          <span />
        </span>
      </Button>
    </div>
  );
}
