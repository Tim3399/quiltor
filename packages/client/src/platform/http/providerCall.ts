import type { AssistantProviderGateway, ProviderProfileId } from "../application";

/**
 * Where each provider profile lives (T-61 part 8a). The only place that holds a provider URL:
 * the executor names a profile, never an address, so no free URL reaches fetch.
 *
 * `test` is the testHooksOrigin of src/quiltor/bootstrap/csp-policy.json, in connect-src only
 * with QUILTOR_TEST_HOOKS=1, and nothing answers it but Playwright's page.route. T-264 adds
 * the real profiles.
 */
const PROVIDER_URLS: Readonly<Record<ProviderProfileId, string>> = {
  test: "https://client-ai.example.test/v1/chat/completions",
};

export function providerUrl(profile: ProviderProfileId): string {
  // Own properties only: "constructor" or "__proto__" must not resolve to anything.
  if (!Object.hasOwn(PROVIDER_URLS, profile)) {
    throw new Error(`Unknown provider profile: ${String(profile)}`);
  }
  return PROVIDER_URLS[profile];
}

export function createProviderCallGateway(): AssistantProviderGateway {
  return {
    async callProvider(profile, { key, body, signal }) {
      const url = providerUrl(profile);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        // fetch rejects with a TypeError for a refused connection and for CORS alike.
        return { kind: "network" };
      }
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch (error) {
        if (signal.aborted) throw error;
      }
      return { kind: "answer", status: response.status, body: parsed };
    },
  };
}
