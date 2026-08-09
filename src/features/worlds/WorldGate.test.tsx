import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../language';
import { WorldGate } from './WorldGate';

afterEach(cleanup);

describe('WorldGate', () => {
  it('opens creation as a separate sheet and creates only after submission', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<LanguageProvider><WorldGate worlds={[]} theme="system" onTheme={vi.fn()} onOpen={vi.fn()} onCreate={onCreate} onDelete={vi.fn()} /></LanguageProvider>);
    expect(screen.queryByRole('dialog', { name: 'Neue Welt' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neue Welt' }));
    expect(screen.getByRole('dialog', { name: 'Neue Welt' })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Zum Beispiel: Der letzte Garten'), { target: { value: 'Testwelt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Welt erstellen' }));
    expect(onCreate).toHaveBeenCalledWith('Testwelt', '');
  });
});
