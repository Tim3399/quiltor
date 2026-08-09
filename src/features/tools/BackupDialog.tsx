import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Dialog } from '../../shared/ui/Dialog';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';

export function BackupDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const [items, setItems] = useState<Array<{ name: string; created: string; size: number }>>([]), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  useFlushedEffect(flush, () => api.backups().then(result => setItems(result.backups)).catch(reason => setError(errorMessage(reason))));
  const restore = async () => { if (!selected) return; try { await api.restore(selected); location.reload(); } catch (reason) { setError(errorMessage(reason)); setSelected(null); } };
  return <><Dialog title="Sicherungen" onClose={onClose}><p className="muted">SQLite-Sicherungen entstehen automatisch, höchstens alle fünf Minuten.</p>{error && <div className="error-box">{error}</div>}<div className="backup-list">{items.map(item => <div key={item.name}><span><strong>{new Date(item.created).toLocaleString('de-DE')}</strong><small>{(item.size / 1024).toFixed(0)} KB</small></span><button onClick={() => setSelected(item.name)}><RotateCcw />Wiederherstellen</button></div>)}{!items.length && !error && <p>Noch keine Sicherung vorhanden.</p>}</div></Dialog>{selected && <ConfirmDialog title="Sicherung wiederherstellen" description="Der aktuelle Stand wird zunächst gesichert und anschließend vollständig durch diese Sicherung ersetzt." confirmLabel="Wiederherstellen" onConfirm={() => void restore()} onClose={() => setSelected(null)} />}</>;
}
