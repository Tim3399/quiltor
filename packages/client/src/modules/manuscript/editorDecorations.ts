import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { VersionDiffProjection } from "../history";
import { normalizeMarks } from "./marks";
import type { EntityMention, TextMark, WritingIssue } from "./model";

type SearchDecorationState = {
  matches: Array<{ from: number; to: number }>;
  active: { from: number; to: number } | null;
};

export const setMentionDecorations = StateEffect.define<EntityMention[]>();
export const setMarkDecorations = StateEffect.define<TextMark[]>();
export const setIssueDecorations = StateEffect.define<WritingIssue[]>();
export const setSearchDecorations = StateEffect.define<SearchDecorationState>();
export const setVersionDiffDecorations = StateEffect.define<{
  projection: VersionDiffProjection | null;
  addedLabel: string;
  addedLineBreakLabel: string;
  removedLabel: string;
  formattingAddedLabels: Record<"bold" | "italic", string>;
  formattingRemovedLabels: Record<"bold" | "italic", string>;
}>();

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

class RemovedTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly label: string,
  ) {
    super();
  }

  eq(other: RemovedTextWidget) {
    return other.text === this.text && other.label === this.label;
  }

  toDOM() {
    const removed = document.createElement("span");
    removed.className = "version-diff-removed";
    removed.setAttribute("aria-label", `${this.label}: ${this.text}`);
    // A line break at a widget edge otherwise occupies space without leaving a visible clue.
    removed.textContent = this.text.replace(/^\n/, "↵\n").replace(/\n$/, "\n↵");
    return removed;
  }

  ignoreEvent() {
    return true;
  }
}

class AddedLineBreakWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: AddedLineBreakWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const indicator = document.createElement("span");
    indicator.className = "version-diff-added version-diff-line-break";
    indicator.setAttribute("aria-label", this.label);
    indicator.title = this.label;
    indicator.textContent = "↵";
    return indicator;
  }

  ignoreEvent() {
    return true;
  }
}

const versionDiffDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setVersionDiffDecorations)) continue;
      const { projection } = effect.value;
      if (!projection) return Decoration.none;
      const decorations = [
        ...projection.changes.flatMap((change) => {
          if (change.kind === "removed") {
            return Decoration.widget({
              widget: new RemovedTextWidget(change.text, effect.value.removedLabel),
              side: -1,
            }).range(change.at);
          }
          const additions = [
            Decoration.mark({
              class: "version-diff-added",
              attributes: { "aria-label": effect.value.addedLabel },
            }).range(change.from, change.to),
          ];
          for (
            let index = change.text.indexOf("\n");
            index >= 0;
            index = change.text.indexOf("\n", index + 1)
          ) {
            additions.push(
              Decoration.widget({
                widget: new AddedLineBreakWidget(effect.value.addedLineBreakLabel),
                side: -1,
              }).range(change.from + index),
            );
          }
          return additions;
        }),
        ...projection.formattingChanges.map((change) =>
          Decoration.mark({
            class:
              change.kind === "format-added"
                ? "version-diff-format-added"
                : "version-diff-format-removed",
            attributes: {
              "aria-label":
                change.kind === "format-added"
                  ? effect.value.formattingAddedLabels[change.markKind]
                  : effect.value.formattingRemovedLabels[change.markKind],
              title:
                change.kind === "format-added"
                  ? effect.value.formattingAddedLabels[change.markKind]
                  : effect.value.formattingRemovedLabels[change.markKind],
            },
          }).range(change.from, change.to),
        ),
      ];
      return Decoration.set(decorations, true);
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const editorDecorationExtensions = [
  mentionDecorations,
  markDecorations,
  issueDecorations,
  heldSelectionDecoration,
  searchDecorations,
  versionDiffDecorations,
];
