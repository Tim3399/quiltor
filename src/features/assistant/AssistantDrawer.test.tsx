import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantDrawer } from './AssistantDrawer';
import { api } from '../../lib/api';
import type { AssistantReply, Chapter, FigureState } from '../../types';

vi.mock('../../lib/api', () => ({ api: { assistantStatus: vi.fn(), assistantChat: vi.fn() } }));

// jsdom doesn't implement scrollIntoView; the drawer calls it on every entries change.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const FIGURES: FigureState = { nodes: [{ id: 'tarek', x: 0, y: 0, name: 'Tarek Venn', type: 'person' }], edges: [] };
const CHAPTERS: Chapter[] = [{ id: 'c1', title: 'Die Krönung', body: '', note: '' }, { id: 'c2', title: 'Am Fluss', body: '', note: '' }];
const ONLINE = { ok: true, available: true, mode: 'local', reason: '', chunks: 3 };
const OFFLINE = { ok: true, available: false, mode: 'local', reason: 'Lokales Modell ist noch nicht installiert.', chunks: 0 };

function reply(patch: Partial<AssistantReply> = {}): AssistantReply {
  return { ok: true, message: 'Alles bereit.', proposals: [], sources: [], ...patch };
}

function setup(worldId = 'world-1', chapters: Chapter[] = CHAPTERS) {
  const onApply = vi.fn(), onNavigate = vi.fn(), onClose = vi.fn();
  const { unmount } = render(<AssistantDrawer worldId={worldId} figures={FIGURES} chapters={chapters} onApply={onApply} onNavigate={onNavigate} onClose={onClose} />);
  return { onApply, onNavigate, onClose, unmount };
}

async function askQuestion(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …'), { target: { value: question } });
  fireEvent.click(screen.getByLabelText('Nachricht senden'));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.assistantStatus).mockReset().mockResolvedValue(ONLINE);
  vi.mocked(api.assistantChat).mockReset();
});

describe('AssistantDrawer', () => {
  it('shows the empty-state prompt and quick actions when there is no history yet', async () => {
    setup();
    expect(await screen.findByText('Wobei soll ich die Welt pflegen?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fehlende Figuren finden'));
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toHaveValue('Lege aus meinen vorhandenen Notizen fehlende Figuren als Vorschläge an.');
    expect(api.assistantChat).not.toHaveBeenCalled();
  });

  it('disables input and shows the offline banner when the model is unavailable', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValue(OFFLINE);
    setup();
    expect(await screen.findByText('Lokales Modell nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText(OFFLINE.reason)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toBeDisabled();
  });

  it('re-checks availability when "Nochmal versuchen" is clicked', async () => {
    vi.mocked(api.assistantStatus).mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(ONLINE);
    setup();
    await screen.findByText('Lokales Modell nicht verfügbar');
    fireEvent.click(screen.getByText('Nochmal versuchen'));
    await waitFor(() => expect(screen.queryByText('Lokales Modell nicht verfügbar')).not.toBeInTheDocument());
    expect(api.assistantStatus).toHaveBeenCalledTimes(2);
  });

  it('shows a sending indicator while a request is in flight, then renders the reply', async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.assistantChat).mockReturnValue(new Promise(resolve => { resolveChat = resolve; }));
    setup();
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Wer ist Tarek?');
    expect(screen.getByPlaceholderText('Figur anlegen, Beziehung ändern, Timeline prüfen …')).toBeDisabled();
    expect(screen.getByText(/durchsucht deine Welt/)).toBeInTheDocument();
    await act(async () => resolveChat(reply({ message: 'Tarek ist ein Ritter.' })));
    expect(await screen.findByText('Tarek ist ein Ritter.')).toBeInTheDocument();
    expect(screen.queryByText(/durchsucht deine Welt/)).not.toBeInTheDocument();
  });

  it('shows an error with a retry action, and retry re-sends the same question', async () => {
    vi.mocked(api.assistantChat).mockRejectedValueOnce(new Error('Das lokale Modell ist nicht erreichbar.')).mockResolvedValueOnce(reply({ message: 'Jetzt hat es geklappt.' }));
    setup();
    await screen.findByText('Wobei soll ich die Welt pflegen?');
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
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Wer ist Tarek?');
    fireEvent.click(screen.getByLabelText('Anfrage abbrechen'));
    await act(async () => rejectChat(new DOMException('aborted', 'AbortError')));
    expect(await screen.findByText('Anfrage abgebrochen.')).toBeInTheDocument();
  });

  it('applying a single proposal calls onApply with just that proposal and marks it applied', async () => {
    const proposals = [{ kind: 'create_element' as const, tempId: 'new:igor', element: { name: 'Igor' } }];
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ proposals }));
    const { onApply } = setup();
    await screen.findByText('Wobei soll ich die Welt pflegen?');
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
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Lege Igor als Sohn von Tarek an.');
    const individualButtons = await screen.findAllByText('Im Paket');
    expect(individualButtons).toHaveLength(2);
    expect(individualButtons[0].closest('button')).toBeDisabled();
    expect(screen.getByText('Alle übernehmen').closest('button')).not.toBeDisabled();
  });

  it('clicking a source navigates to its target', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ sources: [{ id: 'element:tarek', kind: 'element', title: 'Tarek Venn', text: '...', target: { workspace: 'figures', id: 'tarek' } }] }));
    const { onNavigate } = setup();
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Wer ist Tarek?');
    fireEvent.click(await screen.findByText('Tarek Venn'));
    expect(onNavigate).toHaveBeenCalledWith({ workspace: 'figures', id: 'tarek' });
  });

  it('persists entries per worldId and starts fresh for a different world', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ message: 'Gemerkt.' }));
    const { unmount } = setup('world-a');
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Wer ist Tarek?');
    await screen.findByText('Gemerkt.');
    unmount();

    setup('world-a');
    expect(await screen.findByText('Wer ist Tarek?')).toBeInTheDocument();
    cleanup();

    setup('world-b');
    expect(await screen.findByText('Wobei soll ich die Welt pflegen?')).toBeInTheDocument();
  });

  it('"Neuer Chat" clears the transcript after confirmation', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply({ message: 'Gemerkt.' }));
    setup('world-clear');
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    await askQuestion('Wer ist Tarek?');
    await screen.findByText('Gemerkt.');
    fireEvent.click(screen.getByLabelText('Neuer Chat'));
    fireEvent.click(screen.getByText('Neuer Chat starten'));
    expect(await screen.findByText('Wobei soll ich die Welt pflegen?')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('quiltor-assistant:world-clear') || '[]')).toEqual([]);
  });

  it('sends the picked chapters as chapterIds and shows the count in the picker summary', async () => {
    vi.mocked(api.assistantChat).mockResolvedValue(reply());
    setup();
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    fireEvent.click(screen.getByText('1. Die Krönung'));
    expect(screen.getByText('Kontext: 1 Kapitel erzwungen')).toBeInTheDocument();
    await askQuestion('Fasse das zusammen.');
    expect(vi.mocked(api.assistantChat).mock.calls[0][3]).toEqual(['c1']);
  });

  it('does not render the chapter picker when the manuscript has no chapters', async () => {
    setup('world-empty', []);
    await screen.findByText('Wobei soll ich die Welt pflegen?');
    expect(screen.queryByText('Kontext: gesamte Welt')).not.toBeInTheDocument();
  });
});
