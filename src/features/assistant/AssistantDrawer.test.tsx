import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantDrawer } from './AssistantDrawer';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../language';
import type { AssistantReply, Chapter, FigureState } from '../../types';

vi.mock('../../lib/api', () => ({ api: { assistantStatus: vi.fn(), assistantChat: vi.fn(), assistantInstall: vi.fn(), assistantInstallStatus: vi.fn() }, errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));

// jsdom doesn't implement scrollIntoView; the drawer calls it on every entries change.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const FIGURES: FigureState = { nodes: [{ id: 'tarek', x: 0, y: 0, name: 'Tarek Venn', type: 'person' }], edges: [] };
const CHAPTERS: Chapter[] = [{ id: 'c1', title: 'Die Krönung', body: '', note: '' }, { id: 'c2', title: 'Am Fluss', body: '', note: '' }];
const ONLINE = { ok: true, available: true, mode: 'local', reason: '', installed: true, chunks: 3 };
// Installed but currently not running (e.g. the process crashed) -- distinct from
// NOT_INSTALLED below, which drives the "Jetzt einrichten" button instead of "Erneut versuchen".
const OFFLINE = { ok: true, available: false, mode: 'local', reason: 'Lokaler Modell-Prozess ist beendet.', installed: true, chunks: 0 };
const NOT_INSTALLED = { ok: true, available: false, mode: 'local', reason: 'Lokales Modell ist noch nicht installiert oder gestartet.', installed: false, chunks: 0 };

function reply(patch: Partial<AssistantReply> = {}): AssistantReply {
  return { ok: true, message: 'Alles bereit.', proposals: [], sources: [], ...patch };
}

function setup(worldId = 'world-1', chapters: Chapter[] = CHAPTERS, open = true) {
  const onApply = vi.fn(), onNavigate = vi.fn(), onClose = vi.fn();
  const { unmount, rerender } = render(<LanguageProvider><AssistantDrawer worldId={worldId} figures={FIGURES} chapters={chapters} open={open} onApply={onApply} onNavigate={onNavigate} onClose={onClose} /></LanguageProvider>);
  const setOpen = (value: boolean) => rerender(<LanguageProvider><AssistantDrawer worldId={worldId} figures={FIGURES} chapters={chapters} open={value} onApply={onApply} onNavigate={onNavigate} onClose={onClose} /></LanguageProvider>);
  return { onApply, onNavigate, onClose, unmount, setOpen };
}

async function askQuestion(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …'), { target: { value: question } });
  fireEvent.click(screen.getByLabelText('Nachricht senden'));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.assistantStatus).mockReset().mockResolvedValue(ONLINE);
  vi.mocked(api.assistantChat).mockReset();
  vi.mocked(api.assistantInstall).mockReset().mockResolvedValue({ ok: true, started: true });
  // pollInstall() now runs unconditionally on every mount (see the fix for
  // install progress surviving a drawer close/reopen), so every test needs a
  // default resolution here even when it has nothing to do with installing.
  vi.mocked(api.assistantInstallStatus).mockReset().mockResolvedValue({ ok: true, running: false, phase: '', percent: 0, error: '' });
});

describe('AssistantDrawer', () => {
  it('shows the empty-state prompt and quick actions when there is no history yet', async () => {
    setup();
    expect(await screen.findByText('Was soll ich in der Welt nachtragen?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fehlende Figuren finden'));
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toHaveValue('Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.');
    expect(api.assistantChat).not.toHaveBeenCalled();
  });

  it('disables input and shows the offline banner when the model is unavailable', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValue(OFFLINE);
    setup();
    expect(await screen.findByText('Lokales Modell nicht erreichbar')).toBeInTheDocument();
    expect(screen.getByText(OFFLINE.reason)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toBeDisabled();
  });

  it('re-checks availability when "Erneut versuchen" is clicked', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(ONLINE);
    setup();
    await screen.findByText('Lokales Modell nicht erreichbar');
    fireEvent.click(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(screen.queryByText('Lokales Modell nicht erreichbar')).not.toBeInTheDocument());
    expect(api.assistantStatus).toHaveBeenCalledTimes(2);
  });

  it('offers "Jetzt einrichten" instead of "Erneut versuchen" when the model was never installed', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValue(NOT_INSTALLED);
    setup();
    await screen.findByText('Lokales Modell nicht erreichbar');
    expect(screen.getByText('Jetzt einrichten')).toBeInTheDocument();
    expect(screen.queryByText('Erneut versuchen')).not.toBeInTheDocument();
  });

  it('installing shows a progress bar while the install is running', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.assistantInstallStatus)
      .mockResolvedValueOnce({ ok: true, running: false, phase: '', percent: 0, error: '' }) // mount: nothing running yet
      .mockResolvedValue({ ok: true, running: true, phase: 'Runtime', percent: 42, error: '' }); // after the click
    setup();
    fireEvent.click(await screen.findByText('Jetzt einrichten'));
    expect(await screen.findByText('Wird eingerichtet … 42%')).toBeInTheDocument();
    expect(api.assistantInstall).toHaveBeenCalledTimes(1);
  });

  it('re-checks status once the install reports it finished', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValueOnce(NOT_INSTALLED).mockResolvedValueOnce(ONLINE);
    vi.mocked(api.assistantInstallStatus).mockResolvedValue({ ok: true, running: false, phase: '', percent: 100, error: '' });
    setup();
    fireEvent.click(await screen.findByText('Jetzt einrichten'));
    await waitFor(() => expect(api.assistantStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Lokales Modell nicht erreichbar')).not.toBeInTheDocument());
  });

  it('reopening the drawer mid-install shows the current progress instead of resetting', async () => {
    // Regression test: closing the drawer used to lose all install progress
    // client-side even though backend/llm/installer.py's background thread keeps
    // the real download running -- reopening must resume watching it, not show
    // "Jetzt einrichten" again as if nothing were happening.
    vi.mocked(api.assistantStatus).mockResolvedValue(NOT_INSTALLED);
    vi.mocked(api.assistantInstallStatus).mockResolvedValue({ ok: true, running: true, phase: 'Runtime', percent: 77, error: '' });
    const { unmount } = setup();
    await screen.findByText('Wird eingerichtet … 77%');
    unmount();

    setup(); // simulates reopening the assistant drawer
    expect(await screen.findByText('Wird eingerichtet … 77%')).toBeInTheDocument();
    expect(screen.queryByText('Jetzt einrichten')).not.toBeInTheDocument();
  });

  it('shows a sending indicator while a request is in flight, then renders the reply', async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.assistantChat).mockReturnValue(new Promise(resolve => { resolveChat = resolve; }));
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toBeDisabled();
    expect(screen.getByText(/durchsuche deine Welt/)).toBeInTheDocument();
    await act(async () => resolveChat(reply({ message: 'Tarek ist ein Ritter.' })));
    expect(await screen.findByText('Tarek ist ein Ritter.')).toBeInTheDocument();
    expect(screen.queryByText(/durchsuche deine Welt/)).not.toBeInTheDocument();
  });

  it('closing the panel mid-request does not lose the in-flight reply -- it lands once reopened', async () => {
    // The drawer used to fully unmount on close (App.tsx's `assistantOpen && <...>`),
    // discarding `sending`/entries state and any in-flight request's eventual result.
    // It now stays mounted and only its visible markup is gated on `open` (see
    // AssistantDrawer's final return and App.tsx's `assistantEverOpened`), so a
    // request started while open keeps running and lands normally after a close/reopen.
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.assistantChat).mockReturnValue(new Promise(resolve => { resolveChat = resolve; }));
    const { setOpen } = setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    expect(screen.getByText(/durchsuche deine Welt/)).toBeInTheDocument();

    setOpen(false);
    expect(screen.queryByText(/durchsuche deine Welt/)).not.toBeInTheDocument(); // hidden, not gone
    await act(async () => resolveChat(reply({ message: 'Tarek ist ein Ritter.' })));

    setOpen(true);
    expect(await screen.findByText('Tarek ist ein Ritter.')).toBeInTheDocument();
    expect(api.assistantChat).toHaveBeenCalledTimes(1); // resumed watching the same request, didn't resend it
  });

  it('shows an error with a retry action, and retry re-sends the same question', async () => {
    vi.mocked(api.assistantChat).mockRejectedValueOnce(new Error('Das lokale Modell ist nicht erreichbar.')).mockResolvedValueOnce(reply({ message: 'Jetzt hat es geklappt.' }));
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    expect(await screen.findByText('Das lokale Modell ist nicht erreichbar.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Erneut versuchen'));
    expect(await screen.findByText('Jetzt hat es geklappt.')).toBeInTheDocument();
    expect(api.assistantChat).toHaveBeenCalledTimes(2);
    // Retried with the same question both times, not a duplicated new entry.
    expect(vi.mocked(api.assistantChat).mock.calls[1][0]).toBe('Wer ist Tarek?');
    expect(screen.getAllByText('Wer ist Tarek?')).toHaveLength(1);
  });

  it('cancelling a request marks it as aborted instead of leaving it stuck sending', async () => {
    let rejectChat!: (error: unknown) => void;
    vi.mocked(api.assistantChat).mockReturnValue(new Promise((_, reject) => { rejectChat = reject; }));
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    fireEvent.click(screen.getByLabelText('Anfrage abbrechen'));
    await act(async () => rejectChat(new DOMException('aborted', 'AbortError')));
    expect(await screen.findByText('Anfrage abgebrochen.')).toBeInTheDocument();
  });

  it('applying a single proposal calls onApply with just that proposal and marks it applied', async () => {
    const proposals = [{ kind: 'create_element' as const, tempId: 'new:igor', element: { name: 'Igor' } }];
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ proposals }));
    const { onApply } = setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Lege Igor an.');
    const applyButton = await screen.findByText('Übernehmen');
    fireEvent.click(applyButton);
    // The tempId is scoped per-entry (new:<entryId>:igor) to avoid collisions across turns --
    // assert on the stable parts, not the generated entry id.
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ kind: 'create_element', element: { name: 'Igor' }, tempId: expect.stringMatching(/^new:.+:igor$/) })]);
    expect(await screen.findByText('Übernommen')).toBeInTheDocument();
  });

  it('disables individual apply buttons for a grouped/atomic proposal set', async () => {
    const proposals = [
      { kind: 'create_element' as const, tempId: 'new:igor', element: { name: 'Igor' } },
      { kind: 'create_relationship' as const, relationship: { from: 'tarek', to: 'new:igor', label: 'Vater von' } },
    ];
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ proposals, proposalGroup: { id: 'task', title: 'Igor anlegen', proposalIndexes: [0, 1] } }));
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Lege Igor als Sohn von Tarek an.');
    const individualButtons = await screen.findAllByText('Im Paket');
    expect(individualButtons).toHaveLength(2);
    expect(individualButtons[0].closest('button')).toBeDisabled();
    expect(screen.getByText('Alle übernehmen').closest('button')).not.toBeDisabled();
  });

  it('clicking a source navigates to its target', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ sources: [{ id: 'element:tarek', kind: 'element', title: 'Tarek Venn', text: '...', target: { workspace: 'figures', id: 'tarek' } }] }));
    const { onNavigate } = setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    fireEvent.click(await screen.findByText('Tarek Venn'));
    expect(onNavigate).toHaveBeenCalledWith({ workspace: 'figures', id: 'tarek' });
  });

  it('renders clarification candidates and sends the selected id as an explicit follow-up', async () => {
    vi.mocked(api.assistantChat)
      .mockResolvedValueOnce(reply({ message: 'Welches Element meinst du?', clarification: { candidates: [{ id: 'tarek', name: 'Tarek Venn', kind: 'person' }] } }))
      .mockResolvedValueOnce(reply({ message: 'Eindeutig.' }));
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Ergänze sein Profil.');
    fireEvent.click(await screen.findByRole('button', { name: 'Tarek Venn' }));
    await screen.findByText('Eindeutig.');
    expect(vi.mocked(api.assistantChat).mock.calls[1][0]).toContain('[tarek]');
  });

  it('sends valid source ids as machine-readable assistant history references', async () => {
    vi.mocked(api.assistantChat)
      .mockResolvedValueOnce(reply({ sources: [{ id: 'element:tarek', kind: 'element', title: 'Tarek', text: '', target: { workspace: 'figures', id: 'tarek' } }] }))
      .mockResolvedValueOnce(reply());
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    await screen.findByText('Tarek');
    await askQuestion('Und sein Profil?');
    expect(vi.mocked(api.assistantChat).mock.calls[1][1]).toContainEqual(expect.objectContaining({ role: 'assistant', references: ['element:tarek'] }));
  });

  it('persists entries per worldId and starts fresh for a different world', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ message: 'Gemerkt.' }));
    const { unmount } = setup('world-a');
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    await screen.findByText('Gemerkt.');
    unmount();

    setup('world-a');
    expect(await screen.findByText('Wer ist Tarek?')).toBeInTheDocument();
    cleanup();

    setup('world-b');
    expect(await screen.findByText('Was soll ich in der Welt nachtragen?')).toBeInTheDocument();
  });

  it('"Neuer Chat" clears the transcript after confirmation', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ message: 'Gemerkt.' }));
    setup('world-clear');
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    await askQuestion('Wer ist Tarek?');
    await screen.findByText('Gemerkt.');
    fireEvent.click(screen.getByLabelText('Neuer Chat'));
    fireEvent.click(screen.getByText('Neuer Chat starten'));
    expect(await screen.findByText('Was soll ich in der Welt nachtragen?')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('quiltor-assistant:world-clear') || '[]')).toEqual([]);
  });

  it('sends the picked chapters as chapterIds and shows the count in the picker summary', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply());
    setup();
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    fireEvent.click(screen.getByText('1. Die Krönung'));
    expect(screen.getByText('Kontext: Kapitelauswahl (1)')).toBeInTheDocument();
    await askQuestion('Fasse das zusammen.');
    expect(vi.mocked(api.assistantChat).mock.calls[0][3]).toEqual(['c1']);
  });

  it('does not render the chapter picker when the manuscript has no chapters', async () => {
    setup('world-empty', []);
    await screen.findByText('Was soll ich in der Welt nachtragen?');
    expect(screen.queryByText('Kontext: gesamte Welt')).not.toBeInTheDocument();
  });
});
