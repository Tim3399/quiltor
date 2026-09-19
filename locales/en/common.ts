// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: "Ready",
  name: "Name",
  unknown: "Unknown",
  untitled: "Untitled",
  loading: "Loading …",
  cut: "Cut",
  copy: "Copy",
  clipboardRefused: "The clipboard refused the text — nothing was cut.",
  errorUnauthorized: "Please sign in to continue.",
  errorForbidden: "You are not allowed to perform this action.",
  errorNotFound: "The requested content could not be found.",
  errorConflict:
    "The saved version changed. Preserve your draft and compare it with the saved version.",
  errorInvalidRequest: "The request is invalid.",
  errorInvalidResponse: "Quiltor received an invalid response.",
  errorUnavailable: "Quiltor is temporarily unavailable. Try again in a moment.",
  errorStorageReadOnly:
    "Storage is read-only. Rescue the draft, check write permissions, and try again.",
  errorStorageFull:
    "There is not enough storage space. Rescue the draft, free up space, and try again.",
  errorStorageLocked:
    "The project is currently locked for writes. Your draft is preserved. Try again or rescue the draft.",
  errorBackupPreviewFailed: "The backup could not be opened for preview. It may be damaged.",
  errorUnknown: "The action could not be completed.",
} as const;
