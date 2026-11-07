import { useCallback, useEffect, useRef, useState } from "react";
import { quiltorClient } from "../../platform";
import type { InstanceCapabilitiesV1 } from "../../platform/contracts/v1/capabilities";
import type { InstanceCapabilities, UserCapabilities } from "../../shared/capabilities";
import { useStatusTick } from "../../shared/hooks/useStatusTick";

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

type Loaded = { instance: InstanceCapabilities; user: UserCapabilities };

async function load(): Promise<Loaded> {
  try {
    const answer = await quiltorClient.application.capabilities.current();
    if (answer) return { instance: fromServer(answer.instance), user: answer.user };
  } catch {
    // 404 from an older server, or no network: fall back below.
  }
  return { instance: await fromWhoami(), user: {} };
}

/**
 * `instance` is read once at start and is null until it is known. `user` is read
 * again on every status tick, so a premium role granted or withdrawn shows without
 * a reload (T-102 D, F-102-2). A failed re-read keeps what was known.
 */
export function useCapabilities(): {
  instance: InstanceCapabilities | null;
  user: UserCapabilities;
} {
  const [instance, setInstance] = useState<InstanceCapabilities | null>(null);
  const [user, setUser] = useState<UserCapabilities>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void load().then((next) => {
      if (!mounted.current) return;
      setInstance(next.instance);
      setUser(next.user);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshUser = useCallback(() => {
    quiltorClient.application.capabilities
      .current()
      .then((answer) => {
        if (answer && mounted.current) setUser(answer.user);
      })
      .catch(() => {});
  }, []);
  useStatusTick(refreshUser);

  return { instance, user };
}
