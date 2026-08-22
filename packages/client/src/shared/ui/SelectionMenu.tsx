import type { RefObject } from "react";
import { Fragment } from "react";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { Popover } from "./Popover";

// `separatorBefore` groups what the menu offers: the ordinary clipboard commands, the two
// formats, then the writing aid. The clipboard entries are ours to carry since the editor
// suppresses WebKit's own context menu -- Paste stays out, because WebKit refuses it to web
// content and ⌘V works natively anyway.
export type SelectionAction = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
};
export function SelectionMenu({
  anchorRef,
  open,
  label,
  actions,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  label: string;
  actions: SelectionAction[];
  onClose: () => void;
}) {
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} label={label}>
      <Menu label={label} onClose={onClose} autoFocus={false}>
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {action.separatorBefore && index > 0 && <MenuSeparator />}
            <MenuItem
              disabled={action.disabled}
              onSelect={() => {
                action.run();
                onClose();
              }}
            >
              {action.label}
              {action.shortcut && <kbd className="ui-menu__shortcut">{action.shortcut}</kbd>}
            </MenuItem>
          </Fragment>
        ))}
      </Menu>
    </Popover>
  );
}
