import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextWorkspace } from './TextWorkspace';
import { LanguageProvider } from '../../language';
import { api } from '../../lib/api';

const manuscript = { chapters: [{ id: 'c1', title: 'Prolog', body: 'Hallo Welt', note: '' }] };
const figures = { nodes: [{ id: 'n1', x: 0, y: 0, name: 'Testfigur' }], edges: [] };

function renderWorkspace(props: React.ComponentProps<typeof TextWorkspace>) {
  return render(<LanguageProvider><TextWorkspace {...props} /></LanguageProvider>);
}

describe('TextWorkspace', () => {
  it('ändert Text ohne die übrige Manuskriptstruktur zu verlieren', async () => {
    const onChange = vi.fn();
    renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn() });
    const editor = screen.getByLabelText('Kapiteltext');
    editor.textContent = 'Neuer Text';
    fireEvent.input(editor, { inputType: 'insertText', data: 'Neuer Text' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chapters: [expect.objectContaining({ id: 'c1', body: 'Neuer Text' })] })));
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
    expect(rendered.getByLabelText('Kapiteltext')).toHaveTextContent('Der Weg beginnt.');
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

  it('ändert beim freien Nachschlagen keinen Manuskripttext ohne Ergebnisaktion', async () => {
    vi.spyOn(api, 'languageStatus').mockResolvedValue({ ok: true, installed: true, stale: false, version: 'test', sources: {} });
    vi.spyOn(api, 'languageLookup').mockResolvedValue({ ok: true, query: 'Haus', language: 'de-DE', mode: 'dictionary', version: 'test', results: [{ lemma: 'Haus', partOfSpeech: 'Substantiv', meaning: 'Gebäude', values: [], source: 'wiktionary' }] });
    const onChange = vi.fn();
    const view = renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn(), inspectorOpen: true });
    const rendered = within(view.container);
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole('tab', { name: 'Schreibhilfe' }));
    fireEvent.click(rendered.getByRole('tab', { name: 'Wörterbuch' }));
    fireEvent.change(rendered.getByLabelText('Suchbegriff'), { target: { value: 'Haus' } });
    fireEvent.submit(rendered.getByLabelText('Suchbegriff').closest('form')!);
    await rendered.findByText('Gebäude');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ändert bei einer Grammatikprüfung keinen Text ohne bestätigte Ersetzung', async () => {
    vi.spyOn(api, 'languageStatus').mockResolvedValue({ ok: true, installed: true, stale: false, version: 'test', sources: {}, grammar: { available: true, installed: true, running: false, version: '6.6', javaVersion: 17, javaRequired: 17, externalConfigured: false, externalEnabled: false, download: { url: '', checksum: '', license: 'LGPL' } } });
    vi.spyOn(api, 'checkGrammar').mockResolvedValue({ ok: true, language: 'de-DE', issues: [{ id: 'i1', from: 0, to: 5, ruleId: 'SPELL', category: 'Rechtschreibung', message: 'Möglicher Fehler', replacements: ['Hallo'] }] });
    const onChange = vi.fn();
    const view = renderWorkspace({ manuscript, figures, onChange, focus: false, onFocus: vi.fn(), inspectorOpen: true });
    const rendered = within(view.container);
    fireEvent.click(rendered.getByRole('tab', { name: 'Schreibhilfe' }));
    await waitFor(() => expect(api.languageStatus).toHaveBeenCalled());
    fireEvent.click(rendered.getByRole('button', { name: 'Text prüfen' }));
    await waitFor(() => expect(api.checkGrammar).toHaveBeenCalledWith('Hallo Welt', ['Testfigur'], expect.any(AbortSignal)));
    expect(onChange).not.toHaveBeenCalled();
  });
});
