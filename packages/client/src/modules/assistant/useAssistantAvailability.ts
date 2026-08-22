import { useCallback, useEffect, useRef, useState } from "react";
import { applicationErrorMessage, quiltorClient } from "../../platform";

const STATUS_POLL_MS = 15000;
const INSTALL_POLL_MS = 1000;

export type AssistantAvailability = {
  available: boolean;
  reason: string;
  installed: boolean;
  chunks: number;
};

export type AssistantInstallState = {
  running: boolean;
  phase: string;
  percent: number;
  error: string;
};

export function useAssistantAvailability() {
  const [status, setStatus] = useState<AssistantAvailability | null>(null);
  const [installState, setInstallState] = useState<AssistantInstallState | null>(null);
  const installPollRef = useRef<number | undefined>(undefined);
  const hadRunningRef = useRef(false);
  const mountedRef = useRef(true);

  const checkStatus = useCallback(() => {
    quiltorClient.application.assistant
      .status()
      .then((nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        setStatus({
          available: false,
          reason: applicationErrorMessage(error),
          installed: false,
          chunks: 0,
        });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkStatus();
    const interval = window.setInterval(checkStatus, STATUS_POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [checkStatus]);

  // Installation continues server-side while the drawer is closed. Polling always
  // re-synchronizes from the gateway so remounting cannot reset visible progress.
  const pollInstall = useCallback(() => {
    quiltorClient.application.assistant
      .installStatus()
      .then((state) => {
        if (!mountedRef.current) return;
        setInstallState(state);
        if (state.running) {
          hadRunningRef.current = true;
          if (!installPollRef.current)
            installPollRef.current = window.setInterval(pollInstall, INSTALL_POLL_MS);
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
  }, [checkStatus]);

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
