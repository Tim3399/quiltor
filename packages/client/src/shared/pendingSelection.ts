import { EditorSelection, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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
 */
export function withPendingSelection(view: EditorView, spec: TransactionSpec): TransactionSpec {
  if (spec.selection || spec.changes || !view.hasFocus) return spec;
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
