import type { ComponentType } from "react";
import * as ToolbarButtonStories from "../../components/ToolbarButton/ToolbarButton.story";
import * as SelectionCardStories from "../../patterns/SelectionCard/SelectionCard.story";
import * as ButtonStories from "../../primitives/Button/Button.story";
import * as CheckboxStories from "../../primitives/Checkbox/Checkbox.story";
import * as FieldStories from "../../primitives/Field/Field.story";
import * as IconButtonStories from "../../primitives/IconButton/IconButton.story";
import * as SelectStories from "../../primitives/Select/Select.story";
import * as TextAreaStories from "../../primitives/TextArea/TextArea.story";
import * as TextFieldStories from "../../primitives/TextField/TextField.story";
import type { DesignStory } from "./types";

// Kept explicit on purpose: adding a stable component is a reviewable catalog change, and the
// browser gallery must never pull arbitrary production modules through a broad glob import.
function collectStories(
  group: DesignStory["group"],
  component: string,
  stories: Record<string, unknown>,
): DesignStory[] {
  return Object.entries(stories).flatMap(([name, candidate]) =>
    isStoryComponent(candidate)
      ? [
          {
            id: `${component}/${name}`,
            group,
            title: name,
            component: candidate,
            status: "experimental" as const,
          },
        ]
      : [],
  );
}

function isStoryComponent(candidate: unknown): candidate is ComponentType {
  return typeof candidate === "function";
}

export const designStories: readonly DesignStory[] = [
  ...collectStories("Actions", "Button", ButtonStories),
  ...collectStories("Actions", "IconButton", IconButtonStories),
  ...collectStories("Actions", "ToolbarButton", ToolbarButtonStories),
  ...collectStories("Forms", "Checkbox", CheckboxStories),
  ...collectStories("Forms", "Field", FieldStories),
  ...collectStories("Forms", "Select", SelectStories),
  ...collectStories("Forms", "TextArea", TextAreaStories),
  ...collectStories("Forms", "TextField", TextFieldStories),
  ...collectStories("Navigation", "SelectionCard", SelectionCardStories),
];
