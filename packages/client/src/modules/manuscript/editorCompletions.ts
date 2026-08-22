import { Annotation } from "@codemirror/state";
import type { FigureNode } from "../story-world";
import type { WordCompletion } from "./autocomplete";
import { completeOneWord } from "./autocomplete";
import { entityCompletion } from "./entityCompletion";
import type { EntityMention } from "./model";

export type EditorCompletion = WordCompletion & { entity?: FigureNode; detail?: string };

export const createdMention = Annotation.define<EntityMention>();

export function suggestEditorCompletion(
  value: string,
  caret: number,
  entities: FigureNode[],
  vocabulary: string[],
  describe: (entity: FigureNode) => string,
): EditorCompletion | null {
  const match = entityCompletion(value, caret, entities, vocabulary);
  return match
    ? { ...match, detail: describe(match.entity) }
    : completeOneWord(value, caret, vocabulary);
}
