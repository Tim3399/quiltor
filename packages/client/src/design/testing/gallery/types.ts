import type { ComponentType } from "react";

export type DesignStory = {
  id: string;
  group: "Actions" | "Forms" | "Navigation" | "Overlays" | "Feedback";
  title: string;
  component: ComponentType;
  status?: "experimental" | "stable" | "deprecated";
};
