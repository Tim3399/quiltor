import type { ComponentType } from "react";
import * as AdaptivePanelStories from "../../components/AdaptivePanel/AdaptivePanel.story";
import * as AlertStories from "../../components/Alert/Alert.story";
import * as ChipStories from "../../components/Chip/Chip.story";
import * as DialogStories from "../../components/Dialog/Dialog.story";
import * as DisclosureStories from "../../components/Disclosure/Disclosure.story";
import * as EmptyStateStories from "../../components/EmptyState/EmptyState.story";
import * as ListboxSelectStories from "../../components/ListboxSelect/ListboxSelect.story";
import * as MenuStories from "../../components/Menu/Menu.story";
import * as PageStateStories from "../../components/PageState/PageState.story";
import * as PopoverStories from "../../components/Popover/Popover.story";
import * as ProgressBarStories from "../../components/ProgressBar/ProgressBar.story";
import * as SaveStatusStories from "../../components/SaveStatus/SaveStatus.story";
import * as ScrollAreaStories from "../../components/ScrollArea/ScrollArea.story";
import * as SheetStories from "../../components/Sheet/Sheet.story";
import * as SidePanelStories from "../../components/SidePanel/SidePanel.story";
import * as TabsStories from "../../components/Tabs/Tabs.story";
import * as ToastStories from "../../components/Toast/Toast.story";
import * as ToolbarButtonStories from "../../components/ToolbarButton/ToolbarButton.story";
import * as UndoRedoControlsStories from "../../components/UndoRedoControls/UndoRedoControls.story";
import * as WorkspaceToolbarStories from "../../components/WorkspaceToolbar/WorkspaceToolbar.story";
import * as CommandPaletteStories from "../../patterns/CommandPalette/CommandPalette.story";
import * as ConfirmDialogStories from "../../patterns/ConfirmDialog/ConfirmDialog.story";
import * as DropdownMenuStories from "../../patterns/DropdownMenu/DropdownMenu.story";
import * as SelectableRowStories from "../../patterns/SelectableRow/SelectableRow.story";
import * as SelectionCardStories from "../../patterns/SelectionCard/SelectionCard.story";
import * as SelectionMenuStories from "../../patterns/SelectionMenu/SelectionMenu.story";
import * as ButtonStories from "../../primitives/Button/Button.story";
import * as CheckboxStories from "../../primitives/Checkbox/Checkbox.story";
import * as FieldStories from "../../primitives/Field/Field.story";
import * as IconButtonStories from "../../primitives/IconButton/IconButton.story";
import * as SegmentedControlStories from "../../primitives/SegmentedControl/SegmentedControl.story";
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
            status: "stable" as const,
          },
        ]
      : [],
  );
}

function isStoryComponent(candidate: unknown): candidate is ComponentType {
  return typeof candidate === "function";
}

export const designStories: readonly DesignStory[] = [
  ...collectStories("Overlays", "AdaptivePanel", AdaptivePanelStories),
  ...collectStories("Feedback", "Alert", AlertStories),
  ...collectStories("Actions", "Button", ButtonStories),
  ...collectStories("Navigation", "Chip", ChipStories),
  ...collectStories("Overlays", "CommandPalette", CommandPaletteStories),
  ...collectStories("Overlays", "ConfirmDialog", ConfirmDialogStories),
  ...collectStories("Overlays", "Dialog", DialogStories),
  ...collectStories("Navigation", "Disclosure", DisclosureStories),
  ...collectStories("Overlays", "DropdownMenu", DropdownMenuStories),
  ...collectStories("Feedback", "EmptyState", EmptyStateStories),
  ...collectStories("Actions", "IconButton", IconButtonStories),
  ...collectStories("Forms", "ListboxSelect", ListboxSelectStories),
  ...collectStories("Overlays", "Menu", MenuStories),
  ...collectStories("Feedback", "PageState", PageStateStories),
  ...collectStories("Overlays", "Popover", PopoverStories),
  ...collectStories("Feedback", "ProgressBar", ProgressBarStories),
  ...collectStories("Feedback", "SaveStatus", SaveStatusStories),
  ...collectStories("Navigation", "ScrollArea", ScrollAreaStories),
  ...collectStories("Forms", "SegmentedControl", SegmentedControlStories),
  ...collectStories("Navigation", "SelectableRow", SelectableRowStories),
  ...collectStories("Navigation", "SelectionMenu", SelectionMenuStories),
  ...collectStories("Overlays", "Sheet", SheetStories),
  ...collectStories("Navigation", "SidePanel", SidePanelStories),
  ...collectStories("Navigation", "Tabs", TabsStories),
  ...collectStories("Feedback", "Toast", ToastStories),
  ...collectStories("Actions", "ToolbarButton", ToolbarButtonStories),
  ...collectStories("Actions", "UndoRedoControls", UndoRedoControlsStories),
  ...collectStories("Navigation", "WorkspaceToolbar", WorkspaceToolbarStories),
  ...collectStories("Forms", "Checkbox", CheckboxStories),
  ...collectStories("Forms", "Field", FieldStories),
  ...collectStories("Forms", "Select", SelectStories),
  ...collectStories("Forms", "TextArea", TextAreaStories),
  ...collectStories("Forms", "TextField", TextFieldStories),
  ...collectStories("Navigation", "SelectionCard", SelectionCardStories),
];
