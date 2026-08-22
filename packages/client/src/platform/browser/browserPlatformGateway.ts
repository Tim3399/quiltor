import type {
  ClipboardGateway,
  ExternalNavigationGateway,
  FileGateway,
  PreferenceStore,
  SaveFileResult,
} from "../PlatformGateway";

const memoryPreferences = new Map<string, string>();
export const browserPreferences: PreferenceStore = {
  get(key) {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return memoryPreferences.get(key) ?? null;
    }
  },
  set(key, value) {
    memoryPreferences.set(key, value);
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Sandboxed WebViews can disable DOM storage; the session fallback remains usable.
    }
  },
  remove(key) {
    memoryPreferences.delete(key);
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      // See set(): a blocked persistence layer must not prevent the app from opening.
    }
  },
};

export const browserClipboard: ClipboardGateway = {
  async writeText(text) {
    if (!globalThis.navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is unavailable in this host.");
    }
    await globalThis.navigator.clipboard.writeText(text);
  },
};

export const browserExternalNavigation: ExternalNavigationGateway = {
  open(url) {
    globalThis.window.open(url, "_blank", "noopener,noreferrer");
  },
};

export const browserFiles: FileGateway = {
  async save(name, content): Promise<SaveFileResult> {
    const url = URL.createObjectURL(content);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      return { status: "saved" };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  },
};
