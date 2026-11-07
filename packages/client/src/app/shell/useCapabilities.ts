import { useCallback, useEffect, useRef, useState } from "react";
import { ApplicationGatewayError, quiltorClient } from "../../platform";
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
 * again so a premium role granted or withdrawn shows without a reload (T-102 D,
 * F-102-2): on every status tick while `polling` (the assistant drawer is open),
 * and once when the window gains focus or becomes visible. A permanent tick would
 * keep the OIDC session alive past its idle limit, because every request may
 * refresh the token (D-T-102-F1, F-102-8). Only a multi-user server has a session
 * and roles to re-read. A 401 or 404 ends re-reading for good; any other failure
 * keeps what was known.
 */
export function useCapabilities(polling = false): {
  instance: InstanceCapabilities | null;
  user: UserCapabilities;
} {
  const [instance, setInstance] = useState<InstanceCapabilities | null>(null);
  const [user, setUser] = useState<UserCapabilities>({});
  const [stopped, setStopped] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);

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
    // focus and visibilitychange arrive together; one request answers both.
    if (inFlight.current) return;
    inFlight.current = true;
    quiltorClient.application.capabilities
      .current()
      .then((answer) => {
        if (answer && mounted.current) setUser(answer.user);
      })
      .catch((error: unknown) => {
        const category = error instanceof ApplicationGatewayError ? error.category : undefined;
        if ((category === "unauthorized" || category === "not_found") && mounted.current) {
          setStopped(true);
        }
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  const rereading = instance?.multiUser === true && !stopped;
  useStatusTick(refreshUser, rereading && polling);

  useEffect(() => {
    if (!rereading) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    window.addEventListener("focus", refreshUser);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refreshUser);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rereading, refreshUser]);

  return { instance, user };
}
