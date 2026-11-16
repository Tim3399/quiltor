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
  /** Jobs may run on a browser engine here (T-61); undefined on an older server. */
  clientAi?: boolean;
  /** QUILTOR_TEST_HOOKS=1 on the server: the test profile may be offered (T-61). */
  testHooks?: boolean;
};

/** An install flag, or the status route's `installable` where the server did not say. */
export function installAllowed(
  flag: boolean | undefined,
  legacyInstallable: boolean | undefined,
): boolean {
  return flag ?? legacyInstallable ?? true;
}

/** Flags of the signed-in session, re-read on the status tick (T-102 D). A flag
 * the server did not send stays undefined; fall back to what the status says. */
export type UserCapabilities = { serverAi?: boolean };

const CapabilitiesContext = createContext<InstanceCapabilities | null>(null);
const UserCapabilitiesContext = createContext<UserCapabilities>({});

export function CapabilitiesProvider({
  value,
  user = {},
  children,
}: {
  value: InstanceCapabilities | null;
  user?: UserCapabilities;
  children: ReactNode;
}) {
  return (
    <CapabilitiesContext.Provider value={value}>
      <UserCapabilitiesContext.Provider value={user}>{children}</UserCapabilitiesContext.Provider>
    </CapabilitiesContext.Provider>
  );
}

/** The instance flags, or null while they load (and outside a provider). */
export function useInstanceCapabilities(): InstanceCapabilities | null {
  return useContext(CapabilitiesContext);
}

/** The session's flags; empty until known and outside a provider. */
export function useUserCapabilities(): UserCapabilities {
  return useContext(UserCapabilitiesContext);
}
