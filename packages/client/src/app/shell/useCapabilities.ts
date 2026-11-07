import { useEffect, useState } from "react";
import { quiltorClient } from "../../platform";
import type { InstanceCapabilitiesV1 } from "../../platform/contracts/v1/capabilities";
import type { InstanceCapabilities } from "../../shared/capabilities";

function fromServer(instance: InstanceCapabilitiesV1): InstanceCapabilities {
  return {
    ...instance,
    multiUser: instance.multiUser ?? false,
    signOut: instance.signOut ?? false,
    deviceSync: instance.deviceSync ?? true,
  };
}

// The sources the client read before T-102, for a server without the endpoint.
async function fromWhoami(): Promise<InstanceCapabilities> {
  try {
    const whoami = await quiltorClient.application.identity.current();
    const multiUser = whoami.ok && whoami.multiUser === true;
    return { multiUser, signOut: multiUser, deviceSync: whoami.syncAvailable ?? true };
  } catch {
    return { multiUser: false, signOut: false, deviceSync: true };
  }
}

async function loadInstance(): Promise<InstanceCapabilities> {
  try {
    const answer = await quiltorClient.application.capabilities.current();
    if (answer) return fromServer(answer.instance);
  } catch {
    // 404 from an older server, or no network: fall back below.
  }
  return fromWhoami();
}

/** `instance` is read once at start and is null until it is known. */
export function useCapabilities(): { instance: InstanceCapabilities | null } {
  const [instance, setInstance] = useState<InstanceCapabilities | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadInstance().then((next) => {
      if (mounted) setInstance(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return { instance };
}
