export type Workspace = "text" | "figures" | "timeline" | "places";

export type TextSearchTarget = {
  query: string;
  from: number;
  to: number;
};

export type WorkspaceTarget = {
  workspace: Workspace;
  id: string;
  textSearch?: TextSearchTarget;
};

export type ViewportMode = "wide" | "regular" | "compact";

export type WorkspaceLayout = {
  navigationOpen: boolean;
  inspectorOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
};
