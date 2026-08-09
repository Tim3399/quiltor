import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Dialog } from '../../shared/ui/Dialog';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';

export function BackupDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Array<{ name: string; created: string; size: number }>>([]), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  useFlushedEffect(flush, () => api.backups().then(result => setItems(result.backups)).catch(reason => setError(errorMessage(reason))));
  const restore = async () => { if (!selected) return; try { await api.restore(selected); location.reload(); } catch (reason) { setError(errorMessage(reason)); setSelected(null); } };
  return <><Dialog title={t('backups')} onClose={onClose}><p className="muted">{t('backupAutoNote')}</p>{error && <div className="error-box">{error}</div>}<div className="backup-list">{items.map(item => <div key={item.name}><span><strong>{new Date(item.created).toLocaleString('de-DE')}</strong><small>{(item.size / 1024).toFixed(0)} KB</small></span><button onClick={() => setSelected(item.name)}><RotateCcw />{t('restore')}</button></div>)}{!items.length && !error && <p>{t('noBackup')}</p>}</div></Dialog>{selected && <ConfirmDialog title={t('restoreBackup')} description={t('restoreConfirmDescription')} confirmLabel={t('restore')} onConfirm={() => void restore()} onClose={() => setSelected(null)} />}</>;
}
