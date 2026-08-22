import type { MessageKey } from "../../../i18n";
import type { FigureKind } from "../model";

export type FigureElementType = {
  kind: FigureKind;
  label: MessageKey;
  initialName: MessageKey;
  nodeLabel: MessageKey;
  quick: boolean;
};

export const FIGURE_ELEMENT_TYPES: FigureElementType[] = [
  {
    kind: "person",
    label: "figure",
    initialName: "newFigureName",
    nodeLabel: "nodeRoleLabel",
    quick: true,
  },
  { kind: "ort", label: "place", initialName: "newPlace", nodeLabel: "place", quick: true },
  {
    kind: "konzept",
    label: "concept",
    initialName: "newConceptName",
    nodeLabel: "concept",
    quick: true,
  },
  {
    kind: "tier",
    label: "animal",
    initialName: "newAnimalName",
    nodeLabel: "animalRoleLabel",
    quick: false,
  },
  {
    kind: "organisation",
    label: "organisation",
    initialName: "newOrganisationName",
    nodeLabel: "organisationRoleLabel",
    quick: false,
  },
  {
    kind: "objekt",
    label: "object",
    initialName: "newObjectName",
    nodeLabel: "objectRoleLabel",
    quick: false,
  },
];
