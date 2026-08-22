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
  errorConflict: "The content changed in the meantime. Reload it and try again.",
  errorInvalidRequest: "The request is invalid.",
  errorInvalidResponse: "Quiltor received an invalid response.",
  errorUnavailable: "Quiltor is temporarily unavailable. Try again in a moment.",
  errorUnknown: "The action could not be completed.",
} as const;
