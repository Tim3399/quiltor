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
 * Which figures and places the insert panel offers.
 *
 * The list there showed every element of the world, and it grows with the world: sooner or
 * later you are hunting one name among sixty. What is not needed gets deselected here.
 *
 * Hidden does not mean deleted -- in the world everything stays as it was. That is also why
 * this is a sheet and not a manage mode in the bar: it is a choice made once, at leisure,
 * not a switch thrown while writing.
 */
export function ElementsSheet({
  open,
  manuscript,
  figures,
  onChange,
  onClose,
}: ElementsSheetProps) {
  const { t } = useI18n();
  const hidden = new Set(manuscript.hiddenElements ?? []);

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...manuscript, hiddenElements: [...next] });
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
