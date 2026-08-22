import type { ApplicationGateway } from "./application";
import type { PlatformGateway } from "./PlatformGateway";

/** Frontend composition boundary assembled by the executable host. */
export interface QuiltorClient {
  readonly platform: PlatformGateway;
  readonly application: ApplicationGateway;
}

export function createQuiltorClient(
  platform: PlatformGateway,
  application: ApplicationGateway,
): QuiltorClient {
  return Object.freeze({ platform, application });
}

function notConfigured(): never {
  throw new Error("QuiltorClient must be configured by the host before the application mounts.");
}

const unconfiguredPlatform: PlatformGateway = {
  preferences: { get: notConfigured, set: notConfigured, remove: notConfigured },
  clipboard: { writeText: notConfigured },
  externalNavigation: { open: notConfigured },
  files: { save: notConfigured },
};
const unconfiguredApplication = new Proxy({} as ApplicationGateway, {
  get: notConfigured,
});

/** Hosts replace this during bootstrap, before React mounts. */
export let quiltorClient = createQuiltorClient(unconfiguredPlatform, unconfiguredApplication);

export function configureQuiltorClient(client: QuiltorClient): void {
  quiltorClient = client;
}
