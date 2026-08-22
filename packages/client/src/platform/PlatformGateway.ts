export type SaveFileResult =
  | { status: "saved"; path?: string }
  | { status: "cancelled" }
  | { status: "failed"; error?: string; code?: string };

export interface PreferenceStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ClipboardGateway {
  writeText(text: string): Promise<void>;
}

export interface ExternalNavigationGateway {
  open(url: string): void;
}

export interface FileGateway {
  save(name: string, content: Blob): Promise<SaveFileResult>;
}

/**
 * Capabilities supplied by the current host. Product modules depend on this
 * contract instead of browser, WebView, Windows, macOS, iOS or Android APIs.
 * A mobile or store host can replace one capability without imitating a browser.
 */
export interface PlatformGateway {
  readonly preferences: PreferenceStore;
  readonly clipboard: ClipboardGateway;
  readonly externalNavigation: ExternalNavigationGateway;
  readonly files: FileGateway;
}
