import { ArrowUpRight } from "lucide-react";
import { IconButton } from "../../design";
import { cardKindClassName } from "../graph";
import type { FigureNode } from "../story-world";
import "./EntityMentionCard.css";

/** What a mention says about itself when the pointer rests on it. */
export interface EntityMentionDescription {
  /** What kind of thing it is, in the reader's language. */
  kind: string;
  /** The short line underneath, usually its description. */
  detail: string;
  /** The accessible name of the one action the card offers. */
  openLabel: string;
}

/**
 * The card behind a name in the manuscript.
 *
 * A mention is a thread back into the world, and this is where the thread shows
 * itself: what the name refers to, what kind of thing it is, and the one way
 * through to it. It reads like the cards on the boards do -- the kind above the
 * name in small capitals, the name in the prose face, its colour carried on the
 * edge -- so that recognising something in the text and recognising it on a
 * board are the same act.
 *
 * Everything here is the design system's. The card used to build itself out of a
 * bare button with an arrow typed into it, which is why it never looked like the
 * rest of the application.
 */
export function EntityMentionCard({
  entity,
  description,
  onOpen,
}: {
  entity: FigureNode;
  description: EntityMentionDescription;
  onOpen: () => void;
}) {
  return (
    <div className={`entity-mention-card ${cardKindClassName(entity.type ?? "person")}`}>
      <span className="entity-mention-card__kind">{description.kind}</span>
      <strong className="entity-mention-card__name">{entity.name}</strong>
      {description.detail ? (
        <span className="entity-mention-card__detail">{description.detail}</span>
      ) : null}
      <IconButton
        className="entity-mention-card__open"
        size="compact"
        appearance="ghost"
        label={description.openLabel}
        icon={<ArrowUpRight />}
        onClick={onOpen}
      />
    </div>
  );
}
