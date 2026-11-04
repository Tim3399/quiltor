export interface IdentityLogoutResult {
  /** Validated identity-provider endpoint. Empty when a local login page is sufficient. */
  logoutUrl?: string;
}

export interface IdentityGateway {
  current(): Promise<{
    ok: boolean;
    sub?: string;
    email?: string;
    name?: string;
    multiUser?: boolean;
    /** False on a hosted server, which offers no device sync (D-61). */
    syncAvailable?: boolean;
  }>;
  logout(): Promise<IdentityLogoutResult>;
}
