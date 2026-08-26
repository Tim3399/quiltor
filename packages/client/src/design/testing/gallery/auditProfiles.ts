export type DesignAuditCapability =
  | "default"
  | "variants"
  | "disabled"
  | "loading"
  | "error"
  | "longContent"
  | "touch"
  | "selection"
  | "keyboard"
  | "overlay"
  | "scrolling"
  | "empty"
  | "responsive"
  | "feedbackTones";

export type DesignAuditProfile = {
  priority: "P0" | "P1" | "P2";
  coverage: Partial<Record<DesignAuditCapability, readonly string[]>>;
};

/**
 * The reviewable state contract for every public design folder.
 *
 * Story discovery alone is intentionally insufficient: a component is only
 * covered when this manifest assigns each scenario to a behavior or content
 * capability. New exports and new stories therefore require an explicit audit
 * decision instead of becoming "stable" by accident.
 */
export const designAuditProfiles = {
  AdaptivePanel: {
    priority: "P1",
    coverage: { default: ["Inline"], overlay: ["Overlay"], responsive: ["Inline", "Overlay"] },
  },
  Alert: {
    priority: "P1",
    coverage: { default: ["Tones"], feedbackTones: ["Tones"], longContent: ["LongContent"] },
  },
  Button: {
    priority: "P0",
    coverage: {
      default: ["Primary"],
      variants: ["Primary", "Secondary", "Ghost", "Danger", "WithLeadingIcon", "WithTrailingIcon"],
      loading: ["Loading"],
      disabled: ["Disabled"],
      selection: ["Pressed"],
      touch: ["Touch"],
      longContent: ["LongLabel"],
    },
  },
  Checkbox: {
    priority: "P0",
    coverage: {
      default: ["Default", "Checked"],
      disabled: ["Disabled"],
      error: ["ErrorState"],
      longContent: ["LongContent"],
      touch: ["Touch"],
    },
  },
  Chip: {
    priority: "P1",
    coverage: { default: ["Variants"], variants: ["Variants"], longContent: ["LongWrappingList"] },
  },
  CommandPalette: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      keyboard: ["Default", "ManyResults"],
      empty: ["QueryRequired"],
      longContent: ["ManyResults"],
      scrolling: ["ManyResults"],
      responsive: ["ManyResults"],
    },
  },
  ConfirmDialog: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      variants: ["HoldToConfirm"],
      keyboard: ["Default", "HoldToConfirm"],
    },
  },
  Dialog: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      variants: ["Wide", "CustomFooter"],
      overlay: ["Default", "Wide", "CustomFooter"],
    },
  },
  Disclosure: {
    priority: "P1",
    coverage: {
      default: ["Closed"],
      variants: ["Open"],
      longContent: ["LongSummary"],
      keyboard: ["Closed", "Open"],
    },
  },
  DropdownMenu: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      overlay: ["InitiallyOpen"],
      keyboard: ["Default", "InitiallyOpen"],
      longContent: ["LongManyItemsOpen"],
      scrolling: ["LongManyItemsOpen"],
      responsive: ["Default", "InitiallyOpen", "LongManyItemsOpen"],
    },
  },
  EmptyState: {
    priority: "P2",
    coverage: {
      default: ["Default"],
      empty: ["Default"],
      longContent: ["CompactLongContent"],
      responsive: ["CompactLongContent"],
    },
  },
  Field: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      variants: ["DescriptionAndHint", "HiddenLabel"],
      error: ["ErrorState"],
      longContent: ["LongContent"],
    },
  },
  IconButton: {
    priority: "P0",
    coverage: {
      default: ["Ghost"],
      variants: ["Ghost", "Secondary", "Primary", "Danger"],
      loading: ["Loading"],
      disabled: ["Disabled"],
      selection: ["Pressed"],
      touch: ["Touch"],
    },
  },
  ListboxSelect: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      disabled: ["Disabled"],
      longContent: ["LongOptions"],
      keyboard: ["Default", "LongOptions"],
      overlay: ["Default", "LongOptions"],
      scrolling: ["LongOptions"],
      responsive: ["LongOptions"],
      touch: ["LongOptions"],
    },
  },
  Menu: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      disabled: ["DisabledAndSelected"],
      selection: ["DisabledAndSelected"],
      keyboard: ["Default", "DisabledAndSelected", "NestedSubmenu"],
      longContent: ["LongLabels"],
      overlay: ["NestedSubmenu"],
      responsive: ["LongLabels", "NestedSubmenu"],
    },
  },
  PageState: {
    priority: "P1",
    coverage: { loading: ["Loading"], error: ["ErrorState"] },
  },
  Popover: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      overlay: ["Default", "OpenNearEdge"],
      responsive: ["OpenNearEdge"],
    },
  },
  ProgressBar: {
    priority: "P2",
    coverage: {
      default: ["Determinate"],
      variants: ["Complete", "Indeterminate"],
      loading: ["Determinate", "Indeterminate"],
    },
  },
  SaveStatus: {
    priority: "P1",
    coverage: {
      default: ["Phases"],
      variants: ["AttentionOnlyLabel"],
      error: ["LongError"],
      longContent: ["LongError"],
    },
  },
  ScrollArea: {
    priority: "P0",
    coverage: {
      default: ["Vertical"],
      variants: ["Horizontal", "BothAxes"],
      scrolling: ["Vertical", "Horizontal", "BothAxes"],
    },
  },
  SegmentedControl: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      disabled: ["DisabledOption"],
      keyboard: ["Default", "DisabledOption"],
      touch: ["Touch"],
    },
  },
  Select: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      variants: ["Hint"],
      error: ["ErrorState"],
      disabled: ["Disabled"],
      longContent: ["LongContent"],
    },
  },
  SelectableRow: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      selection: ["SelectedWithAction"],
      longContent: ["LongContent"],
    },
  },
  SelectionCard: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      variants: ["WithTrailingActions"],
      selection: ["Selected"],
      disabled: ["Disabled"],
      longContent: ["LongContent"],
    },
  },
  SelectionMenu: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      disabled: ["DisabledAction"],
      keyboard: ["Default", "DisabledAction"],
      overlay: ["Default"],
      longContent: ["LongManyActions"],
      scrolling: ["LongManyActions"],
      responsive: ["Default", "LongManyActions"],
    },
  },
  Sheet: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      overlay: ["Default", "WideLongContent"],
      longContent: ["WideLongContent"],
      responsive: ["Default", "WideLongContent"],
    },
  },
  SidePanel: {
    priority: "P0",
    coverage: {
      default: ["Inspector"],
      empty: ["Empty"],
      variants: ["Fill"],
      responsive: ["Inspector", "Fill"],
    },
  },
  Tabs: {
    priority: "P0",
    coverage: {
      default: ["ThreeTabs"],
      disabled: ["LongLabelsAndDisabled"],
      longContent: ["LongLabelsAndDisabled"],
      keyboard: ["ThreeTabs", "LongLabelsAndDisabled"],
      responsive: ["LongLabelsAndDisabled"],
    },
  },
  TextArea: {
    priority: "P1",
    coverage: {
      default: ["Default"],
      variants: ["DescriptionAndHint"],
      error: ["ErrorState"],
      disabled: ["Disabled"],
      longContent: ["LongContent"],
    },
  },
  TextField: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      variants: ["DescriptionAndHint"],
      error: ["ErrorState"],
      disabled: ["Disabled"],
      longContent: ["LongContent"],
    },
  },
  Toast: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      feedbackTones: ["TonesAndLongContent"],
      error: ["ErrorWithRetry", "TonesAndLongContent"],
      longContent: ["TonesAndLongContent"],
    },
  },
  ToolbarButton: {
    priority: "P0",
    coverage: {
      default: ["ResponsiveLabel"],
      variants: ["Pressed", "PersistentLabel"],
      selection: ["Pressed"],
      disabled: ["Disabled"],
      responsive: ["ResponsiveLabel", "PersistentLabel"],
    },
  },
  UndoRedoControls: {
    priority: "P1",
    coverage: {
      default: ["Available"],
      disabled: ["Disabled"],
      keyboard: ["Available", "Disabled"],
    },
  },
  WorkspaceToolbar: {
    priority: "P0",
    coverage: {
      default: ["Default"],
      longContent: ["LongContent"],
      responsive: ["Default", "LongContent"],
      scrolling: ["LongContent"],
    },
  },
} as const satisfies Record<string, DesignAuditProfile>;
