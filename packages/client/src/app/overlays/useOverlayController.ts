import { useCallback, useState } from "react";
import type { VersionsOpenOptions } from "../../modules/history";

export type Overlay = "palette" | "versions" | null;

/** How the versions dialog was asked for. `id` changes with every request, so a dialog that is
 * already open starts over on the requested tab instead of staying where it was. */
export type VersionsRequest = Required<VersionsOpenOptions> & { id: number };

/** The palette ids that lead into the versions dialog, and the tab each one starts on. */
export function versionsOptionsForCommand(command: string): VersionsOpenOptions | undefined {
  switch (command) {
    case "history":
      return { tab: "versions" };
    case "snapshot":
      return { tab: "versions", focusNote: true };
    case "backups":
      return { tab: "backups" };
    default:
      return undefined;
  }
}

export function useOverlayController() {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [versions, setVersions] = useState<VersionsRequest>({
    id: 0,
    tab: "versions",
    focusNote: false,
  });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantEverOpened, setAssistantEverOpened] = useState(false);

  const open = useCallback((next: Exclude<Overlay, null>, options?: VersionsOpenOptions) => {
    if (next === "versions")
      setVersions((previous) => ({
        id: previous.id + 1,
        tab: options?.tab ?? "versions",
        focusNote: options?.focusNote ?? false,
      }));
    setOverlay(next);
  }, []);
  const close = useCallback(() => setOverlay(null), []);
  const toggleAssistant = useCallback(() => {
    setAssistantEverOpened(true);
    setAssistantOpen((value) => !value);
  }, []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);

  return {
    overlay,
    versions,
    setOverlay,
    open,
    close,
    assistantOpen,
    assistantEverOpened,
    toggleAssistant,
    closeAssistant,
  };
}
