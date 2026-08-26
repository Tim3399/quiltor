import type { ReactNode, RefObject } from "react";
import { Fragment } from "react";
import { Menu, MenuItem, MenuSeparator } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import "./SelectionMenu.css";

export type SelectionAction = {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  tone?: "neutral" | "danger";
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
};

export interface SelectionMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  label: string;
  actions: readonly SelectionAction[];
  onClose: () => void;
}

/** A controlled action menu for a selection or editor context. */
export function SelectionMenu({ anchorRef, open, label, actions, onClose }: SelectionMenuProps) {
  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      label={label}
      desktopRole="presentation"
    >
      <Menu className="ui-selection-menu" label={label} onClose={onClose}>
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {action.separatorBefore && index > 0 && <MenuSeparator />}
            <MenuItem
              disabled={action.disabled}
              icon={action.icon}
              label={action.label}
              shortcut={action.shortcut}
              tone={action.tone}
              onSelect={action.run}
            />
          </Fragment>
        ))}
      </Menu>
    </Popover>
  );
}
