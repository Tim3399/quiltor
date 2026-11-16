import { useCallback, useEffect, useRef, useState } from "react";
import { ApplicationGatewayError, applicationErrorMessage, quiltorClient } from "../../platform";
import { useStatusTick } from "../../shared/hooks/useStatusTick";

const INSTALL_POLL_MS = 1000;

export type AssistantAvailability = {
  available: boolean;
  reason: string;
  installed: boolean;
  /** False when the server's operator installs the assistant; missing means true. */
  installable?: boolean;
  /** False for a user without the premium role on a shared server; missing means true. */
  premium?: boolean;
  chunks: number;
};

export type AssistantInstallState = {
  running: boolean;
  phase: string;
  percent: number;
  error: string;
};

/**
 * `open` is whether the drawer is open. The 15 s status tick runs only then, plus one
 * re-read when the window gains focus or becomes visible: a tick that outlives the
 * drawer would keep the OIDC session alive past its idle limit (D-T-217-1). A 401 or
 * 404 ends re-reading for good. The install poll below is exempt: it runs only while
 * an installation is running, which ends on its own.
 */
export function useAssistantAvailability(open: boolean) {
  const [status, setStatus] = useState<AssistantAvailability | null>(null);
  const [installState, setInstallState] = useState<AssistantInstallState | null>(null);
  const installPollRef = useRef<number | undefined>(undefined);
  const hadRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const [stopped, setStopped] = useState(false);

  const checkStatus = useCallback(() => {
    // focus and visibilitychange arrive together; one request answers both.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    quiltorClient.application.assistant
      .status()
      .then((nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        const category = error instanceof ApplicationGatewayError ? error.category : undefined;
        if (category === "unauthorized" || category === "not_found") setStopped(true);
        setStatus({
          available: false,
          reason: applicationErrorMessage(error),
          installed: false,
          chunks: 0,
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [checkStatus]);

  useStatusTick(checkStatus, open && !stopped);

  useEffect(() => {
    if (stopped) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkStatus();
    };
    window.addEventListener("focus", checkStatus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", checkStatus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stopped, checkStatus]);

  // Installation continues server-side while the drawer is closed. Polling always
  // re-synchronizes from the gateway so remounting cannot reset visible progress.
  const pollInstall = useCallback(
    function poll() {
      quiltorClient.application.assistant
        .installStatus()
        .then((state) => {
          if (!mountedRef.current) return;
          setInstallState(state);
          if (state.running) {
            hadRunningRef.current = true;
            if (!installPollRef.current)
              installPollRef.current = window.setInterval(poll, INSTALL_POLL_MS);
          } else {
            window.clearInterval(installPollRef.current);
            installPollRef.current = undefined;
            if (hadRunningRef.current) {
              hadRunningRef.current = false;
              checkStatus();
            }
          }
        })
        .catch(() => {
          // The next regular status check remains authoritative. A transient
          // polling failure must not invent a terminal installation state.
        });
    },
    [checkStatus],
  );

  useEffect(() => {
    pollInstall();
  }, [pollInstall]);

  useEffect(() => () => window.clearInterval(installPollRef.current), []);

  const startInstall = useCallback(() => {
    setInstallState({ running: true, phase: "", percent: 0, error: "" });
    void quiltorClient.application.assistant
      .install()
      .then(() => {
        if (!mountedRef.current) return;
        hadRunningRef.current = true;
        pollInstall();
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        hadRunningRef.current = false;
        window.clearInterval(installPollRef.current);
        installPollRef.current = undefined;
        setInstallState({
          running: false,
          phase: "",
          percent: 0,
          error: applicationErrorMessage(error),
        });
        checkStatus();
      });
  }, [checkStatus, pollInstall]);

  return { status, installState, checkStatus, startInstall };
}
