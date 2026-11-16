import { useCallback, useEffect, useState } from "react";
import { readUiLocale } from "../../i18n";
import { loginUrl } from "../../modules/identity";
import { type IdentityLogoutResult, quiltorClient } from "../../platform";

// `sub` keys the drafts a refused save keeps on this device (T-58 P7b).
type ShellAccount = { sub?: string; email?: string; name?: string };

export function logoutDestination(result: IdentityLogoutResult): string {
  return result.logoutUrl || loginUrl(readUiLocale());
}

export function useShellStatus() {
  const [account, setAccount] = useState<ShellAccount | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    quiltorClient.application.identity
      .current()
      .then((result) => {
        // The account keys drafts (T-58 P7b) and stays tied to a signed-in user of
        // a shared server, not to whether signing out is offered (F-102-3).
        setAccount(result.ok && result.multiUser ? result : null);
      })
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
