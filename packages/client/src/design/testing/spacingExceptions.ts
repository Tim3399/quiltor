export interface DirectSpacingTokenException {
  /** Public design CSS owner, relative to packages/client/src/design. */
  owner: string;
  /** Layout property that still consumes a numeric --space-* token. */
  property: string;
  /** Exact normalized declaration value; any geometry change requires an explicit review. */
  value: string;
  /** Numeric tokens in source order, including repeated occurrences. */
  tokens: readonly string[];
  /** Human-readable relationship, used instead of an anonymous count or pixel budget. */
  relationship: string;
  /** Why this geometry cannot yet be expressed by the audited four-tier rhythm. */
  reason: string;
}

/**
 * Exact, shrinking exceptions for established geometry between the audited spacing tiers.
 *
 * Do not add an entry merely to make the test green. A new exception needs a named relationship
 * and a browser-verified reason why moving it to an existing semantic role would change layout.
 */
export const directSpacingTokenExceptions = [
  {
    owner: "components/Dialog/Dialog.css",
    property: "padding",
    value: "9vh var(--space-20) var(--spacing-section-base)",
    tokens: ["--space-20"],
    relationship: "dialog viewport inline gutter",
    reason:
      "The established 20px viewport gutter sits between regular-wide and section-tight; changing it would alter modal width.",
  },
  {
    owner: "components/Dialog/Dialog.css",
    property: "padding",
    value: "var(--space-18)",
    tokens: ["--space-18"],
    relationship: "dialog content inset",
    reason:
      "The established 18px content inset sits between regular-wide and section-tight; changing it would reflow dialog content.",
  },
  {
    owner: "components/Dialog/Dialog.css",
    property: "padding",
    value: "var(--spacing-regular-tight) var(--space-18) var(--space-18)",
    tokens: ["--space-18", "--space-18"],
    relationship: "dialog footer inline and block-end inset",
    reason:
      "The footer shares the dialog's 18px content edge; changing only this inset would break header, content, and action alignment.",
  },
  {
    owner: "components/EmptyState/EmptyState.css",
    property: "padding",
    value: "var(--space-20)",
    tokens: ["--space-20"],
    relationship: "compact empty-state inset",
    reason:
      "The compact state intentionally keeps a 20px inset between regular and section density; changing it would alter its compact footprint.",
  },
  {
    owner: "components/PageState/PageState.css",
    property: "margin",
    value: "var(--space-18) 0 var(--spacing-compact-wide)",
    tokens: ["--space-18"],
    relationship: "page-state mark-to-heading separation",
    reason:
      "The 18px optical separation is tied to the 64px state mark; changing it would move the centered message stack.",
  },
  {
    owner: "components/PageState/PageState.css",
    property: "margin-top",
    value: "var(--space-20)",
    tokens: ["--space-20"],
    relationship: "page-state copy-to-actions separation",
    reason:
      "The 20px action separation is an established empty-page rhythm; changing it would alter the centered state composition.",
  },
  {
    owner: "components/SidePanel/SidePanel.css",
    property: "padding",
    value: "var(--space-28)",
    tokens: ["--space-28"],
    relationship: "side-panel empty-state inset",
    reason:
      "The 28px inset balances empty content inside the narrow inspector; moving to 24px or 32px would change wrapping and balance.",
  },
] as const satisfies readonly DirectSpacingTokenException[];
