import type { RefObject } from 'react';
import { Menu, MenuItem } from './Menu';
import { Popover } from './Popover';

export type SelectionAction = { id: string; label: string; disabled?: boolean; run: () => void };
export function SelectionMenu({ anchorRef, open, label, actions, onClose }: { anchorRef: RefObject<HTMLElement | null>; open: boolean; label: string; actions: SelectionAction[]; onClose: () => void }) {
  return <Popover anchorRef={anchorRef} open={open} onClose={onClose} label={label}><Menu label={label} onClose={onClose} autoFocus={false}>{actions.map(action => <MenuItem key={action.id} disabled={action.disabled} onSelect={() => { action.run(); onClose(); }}>{action.label}</MenuItem>)}</Menu></Popover>;
}
