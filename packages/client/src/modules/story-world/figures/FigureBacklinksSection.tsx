import { BookOpenText, Clock3, MapPin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { SelectableRow } from "../../../design";
import { type Translate, useI18n } from "../../../i18n";
import { useNoteReferenceContext } from "../../notes";
import { backlinksForWorldReference, type WorldReferenceBacklink } from "../../world-references";
import type { FigureNode } from "../model";
import "./FigureBacklinksSection.css";

function backlinkKindCopy(
  kind: WorldReferenceBacklink["source"]["kind"],
  t: Translate,
): { label: string; icon: ReactNode } {
  switch (kind) {
    case "chapter-note":
    case "chapter-mention":
      return { label: t("referenceBacklinkChapter"), icon: <BookOpenText /> };
    case "entity-note":
      return { label: t("referenceBacklinkEntity"), icon: <UserRound /> };
    case "place-note":
      return { label: t("referenceBacklinkPlace"), icon: <MapPin /> };
    case "timeline-note":
      return { label: t("referenceBacklinkTimeline"), icon: <Clock3 /> };
  }
}

export function FigureBacklinksSection({ figure }: { figure: FigureNode }) {
  const { t } = useI18n();
  const referenceContext = useNoteReferenceContext();
  const target = {
    kind: figure.type === "ort" ? ("place" as const) : ("entity" as const),
    id: figure.id,
  };
  const backlinks = backlinksForWorldReference(referenceContext.backlinks, target);
  const headingId = `figure-backlinks-${figure.id}`;

  return (
    <section className="figure-profile-backlinks" aria-labelledby={headingId}>
      <h3 id={headingId}>{t("referenceBacklinks")}</h3>
      {backlinks.length === 0 ? (
        <p className="figure-profile-backlinks-empty" role="status">
          {t("referenceBacklinksEmpty")}
        </p>
      ) : (
        <ul className="figure-profile-backlinks-list">
          {backlinks.map((backlink) => {
            const source = backlinkKindCopy(backlink.source.kind, t);
            const detail = backlink.source.detail.trim();
            return (
              <li key={backlink.id}>
                <SelectableRow
                  className="figure-profile-backlink"
                  label={[source.label, backlink.source.label, detail, backlink.surface]
                    .filter(Boolean)
                    .join(" – ")}
                  title={backlink.source.label}
                  description={[detail, `„${backlink.surface}“`].filter(Boolean).join(" · ")}
                  metadata={source.label}
                  leading={source.icon}
                  onSelect={() => referenceContext.onOpenBacklink(backlink)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
