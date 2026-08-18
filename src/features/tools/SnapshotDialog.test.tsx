import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../language';
import { SnapshotDialog } from './SnapshotDialog';
import type { BackupLoginStatus } from '../../lib/api';

const backupStatus = vi.fn(), backupLoginStatus = vi.fn(), backupLoginBegin = vi.fn(), backupLogout = vi.fn(), saveSnapshot = vi.fn();

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { backupStatus: () => backupStatus(), backupLoginStatus: () => backupLoginStatus(), backupLoginBegin: () => backupLoginBegin(), backupLogout: () => backupLogout(), saveSnapshot: (message: string, upload: boolean) => saveSnapshot(message, upload) } };
});

function loginStatus(overrides: Partial<BackupLoginStatus> = {}): BackupLoginStatus {
  return { ok: true, configured: true, hosted: false, endpoint: 'https://backup.example', signedIn: false, issuerReachable: true, ...overrides };
}

function show() {
  return render(<LanguageProvider><SnapshotDialog onClose={vi.fn()} flush={() => Promise.resolve()} /></LanguageProvider>);
}

beforeEach(() => {
  backupStatus.mockResolvedValue({ ok: true, endpoint: 'https://backup.example', anzahl: 1, aenderungen: [], vorschlag: 'Kapitel 3' });
  saveSnapshot.mockResolvedValue({ ok: true, log: ['fertig'] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SnapshotDialog', () => {
  it('bietet die Anmeldung an, statt in ein 401 hochzuladen', async () => {
    backupLoginStatus.mockResolvedValue(loginStatus());
    backupLoginBegin.mockResolvedValue({ ok: true, authorizeUrl: 'https://issuer.example/auth?state=x' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    show();
    const button = await screen.findByRole('button', { name: /Bei der Sicherung anmelden/ });
    // Der Hochladen-Knopf ist hier gar nicht da: ein deaktivierter Knopf wäre eine
    // Sackgasse, und genau das soll die Anmeldung ersetzen.
    expect(screen.queryByRole('button', { name: /Sichern & hochladen/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://issuer.example/auth?state=x', '_blank', 'noopener'));
    // Die Anmeldung endet im anderen Fenster -- der Dialog muss selbst nachfragen.
    await waitFor(() => expect(backupLoginStatus.mock.calls.length).toBeGreaterThan(1), { timeout: 4000 });
  });

  it('meldet einen abgelehnten Anmeldebeginn, statt ihn zu verschlucken', async () => {
    backupLoginStatus.mockResolvedValue(loginStatus());
    // ok:false kommt als HTTP 200 -- ein reines catch würde nichts davon mitbekommen.
    backupLoginBegin.mockResolvedValue({ ok: false, grund: 'Kein Endpunkt eingerichtet.' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Bei der Sicherung anmelden/ }));
    expect(await screen.findByText('Kein Endpunkt eingerichtet.')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('bietet keine Anmeldung an, wenn der Anmeldedienst nicht erreichbar ist', async () => {
    backupLoginStatus.mockResolvedValue(loginStatus({ issuerReachable: false }));
    show();
    expect(await screen.findByText(/Der Anmeldedienst des Ziels antwortet gerade nicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bei der Sicherung anmelden/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sichern & hochladen/ })).toBeDisabled();
  });

  it('lädt hoch und zeigt das Konto, sobald angemeldet', async () => {
    backupLoginStatus.mockResolvedValue(loginStatus({ signedIn: true, email: 'autorin@example.org' }));
    show();
    const upload = await screen.findByRole('button', { name: /Sichern & hochladen/ });
    await waitFor(() => expect(upload).toBeEnabled());
    fireEvent.click(upload);
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalledWith('Kapitel 3', true));
    expect(screen.getByText('autorin@example.org')).toBeInTheDocument();
    backupLogout.mockResolvedValue({ ok: true, signedIn: false });
    backupLoginStatus.mockResolvedValue(loginStatus({ signedIn: false }));
    fireEvent.click(screen.getByRole('button', { name: /Abmelden/ }));
    await waitFor(() => expect(backupLogout).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Bei der Sicherung anmelden/ })).toBeInTheDocument();
  });

  it('bleibt ohne eingerichtetes Ziel beim toten Knopf, weil es nichts anzumelden gibt', async () => {
    backupStatus.mockResolvedValue({ ok: true, endpoint: '', anzahl: 0, aenderungen: [] });
    backupLoginStatus.mockResolvedValue(loginStatus({ configured: false, endpoint: '', issuerReachable: false }));
    show();
    expect(await screen.findByRole('button', { name: /Sichern & hochladen/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Bei der Sicherung anmelden/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Der Anmeldedienst des Ziels antwortet gerade nicht/)).not.toBeInTheDocument();
  });
});
