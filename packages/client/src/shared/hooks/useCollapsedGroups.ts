import { useCallback, useState } from "react";
import { quiltorClient } from "../../platform";

const storageKeyFor = (listKey: string, worldId: string | undefined) =>
  `quiltor:collapsed-groups:${listKey}:${worldId ?? ""}`;

function readCollapsed(storageKey: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(quiltorClient.platform.preferences.get(storageKey) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export interface CollapsedGroups {
  isCollapsed: (groupId: string) => boolean;
  setCollapsed: (groupId: string, collapsed: boolean) => void;
}

/**
 * Which groups of one list are folded, remembered per world in the platform preferences.
 *
 * `listKey` names the list (`figures-world`, `storyboard-library`), so two lists in the same
 * world do not share a state. Only collapsed ids are stored: a group that has never been
 * touched, or a kind created later, is open. The stored value is read while rendering and
 * again when the world changes, never in an effect, so a folded group does not flash open.
 */
export function useCollapsedGroups(listKey: string, worldId: string | undefined): CollapsedGroups {
  const storageKey = storageKeyFor(listKey, worldId);
  const [state, setState] = useState(() => ({
    key: storageKey,
    ids: readCollapsed(storageKey),
  }));
  let ids = state.ids;
  if (state.key !== storageKey) {
    ids = readCollapsed(storageKey);
    setState({ key: storageKey, ids });
  }
  const setCollapsed = useCallback(
    (groupId: string, collapsed: boolean) => {
      if (ids.has(groupId) === collapsed) return;
      const next = new Set(ids);
      if (collapsed) next.add(groupId);
      else next.delete(groupId);
      quiltorClient.platform.preferences.set(storageKey, JSON.stringify([...next]));
      setState({ key: storageKey, ids: next });
    },
    [ids, storageKey],
  );
  const isCollapsed = useCallback((groupId: string) => ids.has(groupId), [ids]);
  return { isCollapsed, setCollapsed };
}
