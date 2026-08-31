import { useCallback, useRef, useState } from "react";
import type { Workspace, WorkspaceTarget } from "../../shared";

export type WorkspaceNavigationRequest = WorkspaceTarget & { requestId: number };

export function useWorkspaceController() {
  const [workspace, setWorkspace] = useState<Workspace>("text");
  const [focus, setFocus] = useState(false);
  const [target, setNavigationTarget] = useState<WorkspaceNavigationRequest | null>(null);
  const nextRequestId = useRef(0);

  const selectWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    setFocus(false);
  }, []);
  const setTarget = useCallback((next: WorkspaceTarget) => {
    nextRequestId.current += 1;
    setNavigationTarget({ ...next, requestId: nextRequestId.current });
  }, []);
  const navigate = useCallback(
    (next: WorkspaceTarget) => {
      setWorkspace(next.workspace);
      setTarget(next);
    },
    [setTarget],
  );
  const execute = useCallback((command: string): boolean => {
    if (
      command === "text" ||
      command === "figures" ||
      command === "timeline" ||
      command === "places" ||
      command === "storyboard"
    ) {
      setWorkspace(command);
      setFocus(false);
      return true;
    }
    if (command === "focus") {
      setWorkspace("text");
      setFocus((value) => !value);
      return true;
    }
    return false;
  }, []);

  return {
    workspace,
    setWorkspace,
    selectWorkspace,
    focus,
    setFocus,
    target,
    setTarget,
    navigate,
    execute,
  };
}
