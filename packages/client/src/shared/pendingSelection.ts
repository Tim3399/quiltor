import { EditorSelection, type TransactionSpec } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * How long a held key keeps the selection from being carried over when no document change
 * follows: Backspace at the start of the document, or Enter in a read-only view. CodeMirror
 * reads a held-back Android key within a few frames; this only ends a hold that nothing ends.
 */
const HOLD_TIMEOUT_MS = 250;

/**
 * The input types whose DOM change CodeMirror holds back on Android: Enter, Backspace and
 * Delete, the entries of its `PendingKeys`. Delete only comes as `beforeinput`; CodeMirror's
 * keydown path holds back keyCode 13 and 8 alone, so the keydown handler needs no Delete.
 */
const HELD_INPUT_TYPES = new Set([
  "insertParagraph",
  "insertLineBreak",
  "deleteContentBackward",
  "deleteContentForward",
]);

/**
 * Marks the stretch between an Enter or Backspace and the document change it causes.
 *
 * On Android CodeMirror holds both keys back (`delayAndroidKey`) and reads the DOM change a
 * moment later. A transaction that carries a selection in between makes the view drop that
 * change, and the paragraph break or the deletion is lost (F-161-1). Comparing the DOM with the
 * state cannot see every such change, since an empty line removed or added leaves every line's
 * text alone, so the key itself is what counts.
 *
 * On desktop the change is read inside the same keydown, so the hold ends before anything
 * else can run, and the selection is carried over as before.
 */
export const pendingSelection = ViewPlugin.fromClass(
  class {
    held = false;
    timer: ReturnType<typeof setTimeout> | undefined;

    hold() {
      this.held = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.release(), HOLD_TIMEOUT_MS);
    }

    release() {
      this.held = false;
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.release();
    }

    destroy() {
      clearTimeout(this.timer);
    }
  },
  {
    eventHandlers: {
      keydown(event) {
        if (event.key === "Enter" || event.key === "Backspace") this.hold();
      },
      beforeinput(event) {
        if (HELD_INPUT_TYPES.has(event.inputType)) this.hold();
      },
    },
  },
);

/**
 * Carries a native selection CodeMirror has not read yet into a transaction from outside.
 *
 * A selection made by the browser itself (Ctrl+A, Shift+arrow) reaches CodeMirror one
 * `selectionchange` task later. A transaction that lands in between makes the view discard
 * the pending DOM selection and draw its own, older one back, so the next keystroke goes in
 * front of the text instead of replacing it (T-161). The view's own reader is not public, so
 * the selection is read here with `posAtDOM` and handed over as part of the transaction.
 *
 * Only for transactions that leave the document alone: positions are read in the current
 * document, and a spec that sets its own selection already says where the cursor belongs.
 * The view needs the `pendingSelection` extension; without it a held key goes unnoticed.
 */
export function withPendingSelection(view: EditorView, spec: TransactionSpec): TransactionSpec {
  if (spec.selection || spec.changes || !view.hasFocus) return spec;
  // A selection set during an IME or dead-key composition (¨ + u) can break it off or double
  // the character. `compositionStarted` is the public flag that also covers `composing`: it is
  // true from `compositionstart` on, before the first composed text arrives.
  if (view.compositionStarted) return spec;
  // An Enter or Backspace whose DOM change has not been read yet would be dropped.
  if (view.plugin(pendingSelection)?.held) return spec;
  const root = view.root as Document | (ShadowRoot & { getSelection?: () => Selection | null });
  const native = root.getSelection ? root.getSelection() : document.getSelection();
  const { anchorNode, focusNode } = native ?? {};
  if (!native || !anchorNode || !focusNode) return spec;
  if (!view.contentDOM.contains(anchorNode) || !view.contentDOM.contains(focusNode)) return spec;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(anchorNode, native.anchorOffset);
    head = view.posAtDOM(focusNode, native.focusOffset);
  } catch {
    return spec;
  }
  const current = view.state.selection.main;
  if (current.anchor === anchor && current.head === head) return spec;
  return { ...spec, selection: EditorSelection.single(anchor, head) };
}
