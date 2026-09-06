import { ChipAction, ChipList, EmptyState, Sheet, SheetBody, SheetHeader } from "../../design";
import { useI18n } from "../../i18n";
import type { FigureState } from "../story-world";
import type { Manuscript } from "./model";

interface ElementsSheetProps {
  open: boolean;
  manuscript: Manuscript;
  figures: FigureState;
  onChange: (manuscript: Manuscript) => void;
  onClose: () => void;
}

/**
 * Welche Figuren und Orte der Einfuegen-Bereich anbietet.
 *
 * Die Liste dort zeigte jedes Element der Welt, und sie waechst mit der Welt: irgendwann
 * sucht man den einen Namen zwischen sechzig. Hier wird abgewaehlt, was nicht gebraucht wird.
 *
 * Ausgeblendet heisst nicht geloescht -- in der Welt bleibt alles, wie es war. Deshalb steht
 * hier auch ein Blatt und kein Verwalten-Modus in der Leiste: es ist eine Auswahl, die man
 * einmal in Ruhe trifft, nicht ein Schalter, den man beim Schreiben umlegt.
 */
export function ElementsSheet({
  open,
  manuscript,
  figures,
  onChange,
  onClose,
}: ElementsSheetProps) {
  const { t } = useI18n();
  const hidden = new Set(manuscript.elementeVerborgen ?? []);

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...manuscript, elementeVerborgen: [...next] });
  };

  return (
    <Sheet open={open} label={t("manageElementsTitle")} onClose={onClose}>
      <SheetHeader title={t("manageElementsTitle")} closeLabel={t("close")} onClose={onClose} />
      <SheetBody className="elements-sheet">
        <p className="muted">{t("manageElementsIntro")}</p>
        {figures.nodes.length ? (
          <ChipList className="editable-chips" label={t("figuresPlaces")}>
            {figures.nodes.map((node) => {
              const angeboten = !hidden.has(node.id);
              return (
                <ChipAction
                  key={node.id}
                  className="elements-sheet__chip"
                  selected={angeboten}
                  aria-label={t(angeboten ? "elementShown" : "elementHidden", { name: node.name })}
                  onClick={() => toggle(node.id)}
                >
                  {node.name}
                </ChipAction>
              );
            })}
          </ChipList>
        ) : (
          <EmptyState title={t("elementsEmpty")} headingLevel={3} size="compact" />
        )}
      </SheetBody>
    </Sheet>
  );
}
