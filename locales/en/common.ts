// Truly generic, domain-independent UI vocabulary — not tied to any single feature area.
// Feature-specific phrasing (even if reused across features) belongs in shared.ts instead.
export const common = {
  ready: "Ready",
  name: "Name",
  unknown: "Unknown",
  untitled: "Untitled",
  toolbarMoreActions: "More actions",
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
  errorStorageSchemaNewer:
    "This data comes from a newer version of Quiltor. Update Quiltor and try again. Your current state is unchanged.",
  errorBackupPreviewFailed: "The backup could not be opened for preview. It may be damaged.",
  errorBackupContentIntegrity:
    "This version is damaged and cannot be restored. Your current state is unchanged.",
  errorBackupContentUnavailable:
    "The content of this version could not be retrieved. Your current state is unchanged.",
  errorSyncForbiddenHosted:
    "This server does not sync with other devices. Your versions are already stored on the server.",
  errorInstallForbiddenHosted:
    "On this server, the operator sets up extensions. Nothing can be installed from here.",
  errorSyncTargetInvalid:
    "This address does not work. Enter an address starting with https://, for example https://sync.example.org.",
  errorUnknown: "The action could not be completed.",
} as const;
