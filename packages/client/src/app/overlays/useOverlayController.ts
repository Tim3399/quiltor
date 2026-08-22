import { useCallback, useState } from "react";

export type Overlay = "palette" | "history" | "snapshot" | "backups" | null;

export function useOverlayController() {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantEverOpened, setAssistantEverOpened] = useState(false);

  const open = useCallback((next: Exclude<Overlay, null>) => setOverlay(next), []);
  const close = useCallback(() => setOverlay(null), []);
  const toggleAssistant = useCallback(() => {
    setAssistantEverOpened(true);
    setAssistantOpen((value) => !value);
  }, []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);

  return {
    overlay,
    setOverlay,
    open,
    close,
    assistantOpen,
    assistantEverOpened,
    toggleAssistant,
    closeAssistant,
  };
}
