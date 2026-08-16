import { afterEach, describe, expect, it, vi } from 'vitest';
import { download } from './api';

type Bridge = { save_file: ReturnType<typeof vi.fn> };

function installBridge(save_file: Bridge['save_file']) {
  (window as unknown as { pywebview?: { api: Bridge } }).pywebview = { api: { save_file } };
}

afterEach(() => {
  delete (window as unknown as { pywebview?: unknown }).pywebview;
  vi.restoreAllMocks();
});

describe('download', () => {
  it('lädt im Browser über einen Anker herunter', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    await download('Kapitel.md', '# Kapitel\n');
    expect(click).toHaveBeenCalledOnce();
  });

  it('übergibt den Export in der Desktop-App an die native Brücke statt an einen Anker', async () => {
    // Ein <a download> ist in der Desktop-App genau der Weg, der nichts erzeugt und unter
    // macOS zusätzlich das Fenster blockiert -- siehe hosts/desktop/bridge/files.py.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const save = vi.fn().mockResolvedValue({ ok: true, path: '/Users/test/Kapitel.md' });
    installBridge(save);
    await download('Kapitel.md', '# Kapitel\n');
    expect(click).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('Kapitel.md', btoa('# Kapitel\n'), 'base64');
  });

  it('bleibt still, wenn der Speichern-Dialog abgebrochen wird', async () => {
    installBridge(vi.fn().mockResolvedValue({ ok: false, cancelled: true }));
    await expect(download('Kapitel.md', 'Text')).resolves.toBeUndefined();
  });

  it('meldet einen fehlgeschlagenen Export, statt ihn zu verschlucken', async () => {
    installBridge(vi.fn().mockResolvedValue({ ok: false, error: 'Kein Schreibrecht' }));
    await expect(download('Kapitel.md', 'Text')).rejects.toThrow('Kein Schreibrecht');
  });

  it('meldet auch einen Brückenfehler ohne Verdikt', async () => {
    installBridge(vi.fn().mockRejectedValue(new Error('bridge is gone')));
    await expect(download('Kapitel.md', 'Text')).rejects.toThrow('bridge is gone');
  });
});
