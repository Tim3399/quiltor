import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../language';
import type { FigureState } from '../../types';
import { TimelineWorkspace } from './TimelineWorkspace';

afterEach(cleanup);

const state: FigureState = {
  timeline: [{ id: 'm1', title: 'Ankunft' }],
  nodes: [
    { id: 'ada', x: 0, y: 0, name: 'Ada', type: 'person' },
    { id: 'hafen', x: 0, y: 0, name: 'Hafen', type: 'ort' },
  ],
  edges: [],
};

function renderTimeline() {
  return render(<LanguageProvider><TimelineWorkspace state={state} onChange={vi.fn()} /></LanguageProvider>);
}

describe('TimelineWorkspace sections', () => {
  it('starts focused on relationships and keeps secondary tasks collapsed', () => {
    renderTimeline();
    expect(screen.getByRole('button', { name: 'Beziehungen' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Anwesenheit' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Lebensereignisse' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Unverändert / kein Ort')).not.toBeInTheDocument();
  });

  it('reveals a secondary task from its section header', () => {
    renderTimeline();
    const presence = screen.getByRole('button', { name: 'Anwesenheit' });
    fireEvent.click(presence);
    expect(presence).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Unverändert / kein Ort')).toBeVisible();
  });
});
