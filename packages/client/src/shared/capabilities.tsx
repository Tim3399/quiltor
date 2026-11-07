import { createContext, type ReactNode, useContext } from "react";

/**
 * What the client may offer on this server (T-102). Components branch on these
 * flags, never on an operation profile. The install flags stay undefined when the
 * server could not say (an older server without /api/capabilities); resolve them
 * with `installAllowed` against the `installable` of the status they already read.
 * In shared/ so product modules can read the flags the shell loaded.
 */
export type InstanceCapabilities = {
  multiUser: boolean;
  signOut: boolean;
  deviceSync: boolean;
  assistantInstall?: boolean;
  writingDataInstall?: boolean;
  grammarInstall?: boolean;
};

/** An install flag, or the status route's `installable` where the server did not say. */
export function installAllowed(
  flag: boolean | undefined,
  legacyInstallable: boolean | undefined,
): boolean {
  return flag ?? legacyInstallable ?? true;
}

const CapabilitiesContext = createContext<InstanceCapabilities | null>(null);

export function CapabilitiesProvider({
  value,
  children,
}: {
  value: InstanceCapabilities | null;
  children: ReactNode;
}) {
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

/** The instance flags, or null while they load (and outside a provider). */
export function useInstanceCapabilities(): InstanceCapabilities | null {
  return useContext(CapabilitiesContext);
}
