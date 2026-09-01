import { Button, ScrollArea } from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureNode } from "../model";
import "./PlaceLevelTrail.css";

/**
 * Where in the world the open level sits, and the way back out.
 *
 * The trail is passed in already derived from the parent pointers rather than
 * collected while descending, so it stays correct when a level is reached by a
 * jump from search or a backlink instead of by walking down to it.
 */
export function PlaceLevelTrail({
  trail,
  onGoToLevel,
}: {
  trail: FigureNode[];
  onGoToLevel: (levelId: string | undefined) => void;
}) {
  const { t } = useI18n();
  if (trail.length === 0) return null;
  return (
    <ScrollArea
      as="nav"
      axis="x"
      className="place-level-trail"
      aria-label={t("placeLevelTrail")}
      surface="panel"
    >
      <Button
        size="compact"
        appearance="ghost"
        className="place-level-trail__step"
        onClick={() => onGoToLevel(undefined)}
      >
        {t("placeRootLevel")}
      </Button>
      {trail.map((level, index) => (
        <Button
          key={level.id}
          size="compact"
          appearance="ghost"
          className="place-level-trail__step"
          disabled={index === trail.length - 1}
          onClick={() => onGoToLevel(level.id)}
        >
          {level.name}
        </Button>
      ))}
    </ScrollArea>
  );
}
