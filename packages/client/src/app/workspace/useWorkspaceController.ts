import { useCallback, useState } from "react";
import type { Workspace, WorkspaceTarget } from "../../shared";

export function useWorkspaceController() {
  const [workspace, setWorkspace] = useState<Workspace>("text");
  const [focus, setFocus] = useState(false);
  const [target, setTarget] = useState<WorkspaceTarget | null>(null);

  const selectWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    setFocus(false);
  }, []);
  const navigate = useCallback((next: WorkspaceTarget) => {
    setWorkspace(next.workspace);
    setTarget(next);
  }, []);
  const execute = useCallback((command: string): boolean => {
    if (
      command === "text" ||
      command === "figures" ||
      command === "timeline" ||
      command === "places"
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
