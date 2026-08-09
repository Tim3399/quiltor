import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextWorkspace } from './TextWorkspace';
import { LanguageProvider } from '../../language';

const manuscript = { chapters: [{ id: 'c1', title: 'Prolog', body: 'Hallo Welt', note: '' }] };
const figures = { nodes: [{ id: 'n1', x: 0, y: 0, name: 'Testfigur' }], edges: [] };

function renderWorkspace(props: React.ComponentProps<typeof TextWorkspace>) {
  return render(<LanguageProvider><TextWorkspace {...props} /></LanguageProvider>);
}

describe('TextWorkspace', () => {
  it('ändert Text ohne die übrige Manuskriptstruktur zu verlieren', () => {
    const onChange = vi.fn();
    renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn() });
    fireEvent.change(screen.getByLabelText('Kapiteltext'), { target: { value: 'Neuer Text' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chapters: [expect.objectContaining({ id: 'c1', body: 'Neuer Text' })] }));
  });

  it('macht den Fokusmodus explizit verlassbar', () => {
    renderWorkspace({ manuscript, figures, onChange: vi.fn(), focus: true, onFocus: vi.fn() });
    expect(screen.getByRole('button', { name: /Fokusmodus verlassen/ })).toBeVisible();
  });

  it('wechselt im Fokusmodus subtil zwischen Kapiteln', () => {
    const twoChapters = { chapters: [
      ...manuscript.chapters,
      { id: 'c2', title: 'Aufbruch', body: 'Der Weg beginnt.', note: '' },
    ] };
    const view = renderWorkspace({ manuscript: twoChapters, figures, onChange: vi.fn(), focus: true, onFocus: vi.fn() });
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole('button', { name: 'Kapitelauswahl öffnen' }));
    const picker = rendered.getByRole('complementary', { name: 'Kapitelauswahl im Fokusmodus' });
    expect(within(picker).getByRole('button', { name: /Prolog/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(picker).getByRole('button', { name: /Aufbruch/ }));
    expect(rendered.getByLabelText('Kapiteltitel')).toHaveValue('Aufbruch');
    expect(rendered.getByLabelText('Kapiteltext')).toHaveValue('Der Weg beginnt.');
  });

  it('blendet die Kapitelauswahl bei nur einem Kapitel aus', () => {
    const view = renderWorkspace({ manuscript, figures, onChange: vi.fn(), focus: true, onFocus: vi.fn() });
    expect(within(view.container).queryByRole('combobox', { name: 'Kapitel im Fokusmodus auswählen' })).not.toBeInTheDocument();
  });

  it('ändert persistierbare Panelbreiten auch per Tastatur', () => {
    const onSidebarWidth = vi.fn(), onInspectorWidth = vi.fn();
    renderWorkspace({ manuscript, figures, onChange: vi.fn(), focus: false, onFocus: vi.fn(), viewportMode: 'wide', binderOpen: true, inspectorOpen: true, sidebarWidth: 246, inspectorWidth: 294, onSidebarWidth, onInspectorWidth });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Navigation breiter oder schmaler ziehen' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Inspector breiter oder schmaler ziehen' }), { key: 'ArrowLeft' });
    expect(onSidebarWidth).toHaveBeenCalledWith(256);
    expect(onInspectorWidth).toHaveBeenCalledWith(304);
  });
});
