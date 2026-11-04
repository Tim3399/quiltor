import { useCallback, useEffect, useState } from "react";
import { quiltorClient, type IdentityLogoutResult } from "../../platform";

type ShellAccount = { email?: string; name?: string };

export function logoutDestination(result: IdentityLogoutResult): string {
  return result.logoutUrl || "/login";
}

export function useShellStatus() {
  const [account, setAccount] = useState<ShellAccount | null>(null);
  const [version, setVersion] = useState("");
  // Whether this server syncs worlds with other devices (D-61). Unknown (null) until
  // whoami answers, so nothing sync-only flashes up on a hosted server; a server
  // that does not say (older) or cannot be asked keeps today's local behavior.
  const [syncAvailable, setSyncAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    quiltorClient.application.identity
      .current()
      .then((result) => {
        setAccount(result.ok && result.multiUser ? result : null);
        setSyncAvailable(result.syncAvailable !== false);
      })
      .catch(() => {
        setAccount(null);
        setSyncAvailable(true);
      });
    quiltorClient.application.metadata
      .version()
      .then((result) => setVersion(result.version))
      .catch(() => {});
  }, []);

  const logout = useCallback(() => {
    void quiltorClient.application.identity.logout().then((result) => {
      location.href = logoutDestination(result);
    });
  }, []);

  return { account, version, syncAvailable, logout };
}
