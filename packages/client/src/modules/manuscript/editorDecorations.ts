import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { EntityMention, TextMark, WritingIssue } from "./model";
import { normalizeMarks } from "./marks";

type SearchDecorationState = {
  matches: Array<{ from: number; to: number }>;
  active: { from: number; to: number } | null;
};

export const setMentionDecorations = StateEffect.define<EntityMention[]>();
export const setMarkDecorations = StateEffect.define<TextMark[]>();
export const setIssueDecorations = StateEffect.define<WritingIssue[]>();
export const setSearchDecorations = StateEffect.define<SearchDecorationState>();

// A browser paints ::selection only while the element has focus, so the moment the
// writer reaches into the inspector the marked passage looks unmarked. This keeps the
// range the writing aid is working on visible for as long as it is held.
export const setHeldSelection = StateEffect.define<{ from: number; to: number } | null>();

const mentionDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setMentionDecorations))
        value = Decoration.set(
          effect.value.map((mention) =>
            Decoration.mark({
              class: "entity-mention",
              attributes: { "data-mention-id": mention.id },
            }).range(mention.from, mention.to),
          ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Bold and italic are ranges over the body, never characters in it, so they are drawn the
// same way a mention is -- and, like a mention, they are mapped through every edit so that
// typing in front of a marked passage moves the mark along instead of leaving it behind.
const markDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setMarkDecorations))
        value = Decoration.set(
          normalizeMarks(effect.value, transaction.newDoc.length).map((mark) =>
            Decoration.mark({ class: `text-${mark.kind}` }).range(mark.from, mark.to),
          ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const issueDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setIssueDecorations))
        value = Decoration.set(
          effect.value.map((issue) =>
            Decoration.mark({
              class: "writing-issue",
              attributes: { "data-writing-issue": issue.id },
            }).range(issue.from, issue.to),
          ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const heldSelectionDecoration = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHeldSelection)) continue;
      value =
        effect.value && effect.value.to > effect.value.from
          ? Decoration.set([
              Decoration.mark({ class: "held-selection" }).range(
                effect.value.from,
                effect.value.to,
              ),
            ])
          : Decoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const searchDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSearchDecorations)) continue;
      value = Decoration.set(
        effect.value.matches
          .filter(
            (match) =>
              match.from >= 0 && match.to > match.from && match.to <= transaction.newDoc.length,
          )
          .map((match) =>
            Decoration.mark({
              class:
                effect.value.active?.from === match.from && effect.value.active.to === match.to
                  ? "text-search-match is-active"
                  : "text-search-match",
            }).range(match.from, match.to),
          ),
        true,
      );
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const editorDecorationExtensions = [
  mentionDecorations,
  markDecorations,
  issueDecorations,
  heldSelectionDecoration,
  searchDecorations,
];
