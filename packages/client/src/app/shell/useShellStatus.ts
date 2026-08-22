import { useCallback, useEffect, useState } from "react";
import { quiltorClient, type IdentityLogoutResult } from "../../platform";

type ShellAccount = { email?: string; name?: string };

export function logoutDestination(result: IdentityLogoutResult): string {
  return result.logoutUrl || "/login";
}

export function useShellStatus() {
  const [account, setAccount] = useState<ShellAccount | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    quiltorClient.application.identity
      .current()
      .then((result) => setAccount(result.ok && result.multiUser ? result : null))
      .catch(() => setAccount(null));
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

  return { account, version, logout };
}
