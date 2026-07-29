import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextWorkspace } from './TextWorkspace';

const manuscript = { chapters: [{ id: 'c1', title: 'Prolog', body: 'Hallo Welt', note: '' }] };
const figures = { nodes: [{ id: 'n1', x: 0, y: 0, name: 'Testfigur' }], edges: [] };

describe('TextWorkspace', () => {
  it('ändert Text ohne die übrige Manuskriptstruktur zu verlieren', () => {
    const onChange = vi.fn();
    render(<TextWorkspace manuscript={manuscript} figures={figures} onChange={onChange} focus={false} onFocus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Kapiteltext'), { target: { value: 'Neuer Text' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chapters: [expect.objectContaining({ id: 'c1', body: 'Neuer Text' })] }));
  });

  it('macht den Fokusmodus explizit verlassbar', () => {
    render(<TextWorkspace manuscript={manuscript} figures={figures} onChange={vi.fn()} focus onFocus={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Fokusmodus verlassen/ })).toBeVisible();
  });

  it('wechselt im Fokusmodus subtil zwischen Kapiteln', () => {
    const twoChapters = { chapters: [
      ...manuscript.chapters,
      { id: 'c2', title: 'Aufbruch', body: 'Der Weg beginnt.', note: '' },
    ] };
    const view = render(<TextWorkspace manuscript={twoChapters} figures={figures} onChange={vi.fn()} focus onFocus={vi.fn()} />);
    const rendered = within(view.container);
    const picker = rendered.getByRole('combobox', { name: 'Kapitel im Fokusmodus auswählen' });
    expect(picker).toHaveValue('c1');
    fireEvent.change(picker, { target: { value: 'c2' } });
    expect(rendered.getByLabelText('Kapiteltitel')).toHaveValue('Aufbruch');
    expect(rendered.getByLabelText('Kapiteltext')).toHaveValue('Der Weg beginnt.');
  });

  it('blendet die Kapitelauswahl bei nur einem Kapitel aus', () => {
    const view = render(<TextWorkspace manuscript={manuscript} figures={figures} onChange={vi.fn()} focus onFocus={vi.fn()} />);
    expect(within(view.container).queryByRole('combobox', { name: 'Kapitel im Fokusmodus auswählen' })).not.toBeInTheDocument();
  });
});
