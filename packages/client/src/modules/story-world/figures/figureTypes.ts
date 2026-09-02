import type { MessageKey } from "../../../i18n";
import type { FigureKind } from "../model";

export type FigureElementType = {
  kind: FigureKind;
  label: MessageKey;
  initialName: MessageKey;
  quick: boolean;
};

export const FIGURE_ELEMENT_TYPES: FigureElementType[] = [
  {
    kind: "person",
    label: "figure",
    initialName: "newFigureName",
    quick: true,
  },
  { kind: "ort", label: "place", initialName: "newPlace", quick: true },
  {
    kind: "konzept",
    label: "concept",
    initialName: "newConceptName",
    quick: true,
  },
  {
    kind: "tier",
    label: "animal",
    initialName: "newAnimalName",
    quick: false,
  },
  {
    kind: "organisation",
    label: "organisation",
    initialName: "newOrganisationName",
    quick: false,
  },
  {
    kind: "objekt",
    label: "object",
    initialName: "newObjectName",
    quick: false,
  },
];
