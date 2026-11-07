import { useEffect } from "react";
import { useLatest } from "./useLatest";

/** How often the client re-reads server status: the assistant today, the per-user
 * capabilities from T-102 Teil D. */
export const STATUS_POLL_MS = 15000;

const subscribers = new Set<() => void>();
let interval: number | undefined;

function tick() {
  for (const subscriber of [...subscribers]) subscriber();
}

/**
 * Calls `onTick` every STATUS_POLL_MS on one interval shared by every subscriber,
 * so a second status reader adds no second timer (T-102, F-102-5). The interval
 * runs while at least one component is subscribed. It lives in shared/ because
 * product modules (the assistant) and the shell (capabilities) both subscribe.
 * With `enabled` false the component is not subscribed (D-T-102-F1).
 */
export function useStatusTick(onTick: () => void, enabled = true): void {
  const onTickRef = useLatest(onTick);

  useEffect(() => {
    if (!enabled) return;
    const subscriber = () => onTickRef.current();
    subscribers.add(subscriber);
    if (interval === undefined) interval = window.setInterval(tick, STATUS_POLL_MS);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
  }, [enabled]);
}
