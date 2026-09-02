/**
 * What a card writes above a name.
 *
 * An element has a kind, which the model knows and the card colours by, and a
 * role the author gives it: a protagonist, a companion animal, an intelligence
 * service, an heirloom. The role is the interesting half, so wherever an author
 * has written one it stands in for the kind -- for every kind alike, not only
 * for people.
 *
 * Older worlds carry a complication. New elements used to be created with the
 * interface's own field caption already written into the role, so a fresh
 * animal was stored as "Art / Rolle" and a fresh place as "Ort". Those are
 * captions, not world data, and which one landed depended on the interface
 * language at the moment of creation. They are recognised here and read as an
 * empty role, so an old world shows its kinds rather than a row of form labels.
 *
 * The recognition is deliberately narrow: fixed strings, matched only against
 * the kind that once produced them, never generated through the active
 * translation. Everything an author wrote themselves survives untouched.
 */

import type { MessageKey } from "../../../i18n";
import type { FigureKind, FigureNode } from "../model";
import { kindLabel } from "./relationships";

/** The captions new elements used to be born with, per kind and language. */
const LEGACY_GENERATED_LABELS: Record<FigureKind, ReadonlySet<string>> = {
  person: new Set(["Rolle", "Role"]),
  tier: new Set(["Art / Rolle", "Kind / role"]),
  organisation: new Set(["Art / Funktion", "Kind / function"]),
  objekt: new Set(["Art / Bedeutung", "Kind / meaning"]),
  ort: new Set(["Ort", "Place"]),
  konzept: new Set(["Konzept", "Concept"]),
};

/**
 * The role an author actually wrote, or nothing.
 *
 * Nothing covers three cases that are the same to a reader: never filled in,
 * filled with spaces, and filled by the interface before we knew better.
 */
export function authoredFigureLabel(figure: Pick<FigureNode, "type" | "label">): string {
  const written = figure.label?.trim() ?? "";
  if (!written) return "";
  return LEGACY_GENERATED_LABELS[figure.type ?? "person"].has(written) ? "" : written;
}

/** The role if there is one, otherwise the name of the kind. */
export function figureDisplayLabel(
  figure: Pick<FigureNode, "type" | "label">,
  t: (key: MessageKey) => string,
): string {
  return authoredFigureLabel(figure) || kindLabel(figure.type, t);
}
