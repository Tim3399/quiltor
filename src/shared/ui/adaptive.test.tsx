import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, MenuItem } from './Menu';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';

describe('adaptive UI primitives', () => {
  it('exposes a segmented control as a radiogroup', () => {
    const change = vi.fn();
    render(<SegmentedControl label="Ansicht" value="a" onChange={change} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(change).toHaveBeenCalledWith('b');
  });

  it('moves through menu items with arrows and closes with Escape', () => {
    const close = vi.fn();
    render(<Menu label="Aktionen" onClose={close}><MenuItem onSelect={() => undefined}>Eins</MenuItem><MenuItem onSelect={() => undefined}>Zwei</MenuItem></Menu>);
    const first = screen.getByRole('menuitem', { name: 'Eins' }), second = screen.getByRole('menuitem', { name: 'Zwei' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('restores focus when a sheet closes', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const { rerender } = render(<Sheet open label="Details" onClose={() => undefined}><button>Aktion</button></Sheet>);
    rerender(<Sheet open={false} label="Details" onClose={() => undefined}><button>Aktion</button></Sheet>);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
