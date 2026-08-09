import { useState } from 'react';
import { Archive, RotateCcw, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Sheet } from '../../shared/ui/Sheet';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';

export function BackupDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Array<{ name: string; created: string; size: number }>>([]), [selected, setSelected] = useState<string | null>(null), [restoreTarget, setRestoreTarget] = useState<string | null>(null), [error, setError] = useState('');
  useFlushedEffect(flush, () => api.backups().then(result => setItems(result.backups)).catch(reason => setError(errorMessage(reason))));
  const restore = async () => { if (!restoreTarget) return; try { await api.restore(restoreTarget); location.reload(); } catch (reason) { setError(errorMessage(reason)); setRestoreTarget(null); } };
  const selectedItem = items.find(item => item.name === selected);
  return <><Sheet open label={t('backups')} onClose={onClose} wide><div className="utility-sheet"><header><h2>{t('backups')}</h2><button className="icon-button" aria-label={t('closeDialog')} onClick={onClose}><X /></button></header><div className="utility-sheet-content"><p className="muted">{t('backupAutoNote')}</p>{error && <div className="error-box" role="alert">{error}</div>}<div className="utility-split backup-browser"><nav className="backup-list" aria-label={t('backups')}>{items.map(item => <button key={item.name} className={selected === item.name ? 'active' : ''} aria-pressed={selected === item.name} onClick={() => setSelected(item.name)}><Archive /><span><strong>{new Date(item.created).toLocaleString()}</strong><small>{(item.size / 1024).toFixed(0)} KB</small></span></button>)}{!items.length && !error && <p>{t('noBackup')}</p>}</nav><section className="backup-preview">{selectedItem ? <><Archive /><h3>{new Date(selectedItem.created).toLocaleString()}</h3><p>{t('backupPreviewDescription', { size: `${(selectedItem.size / 1024).toFixed(0)} KB` })}</p><button className="primary" onClick={() => setRestoreTarget(selectedItem.name)}><RotateCcw />{t('restore')}</button></> : <><Archive /><h3>{t('backupSelectTitle')}</h3><p>{t('backupSelectDescription')}</p></>}</section></div></div></div></Sheet>{restoreTarget && <ConfirmDialog title={t('restoreBackup')} description={t('restoreConfirmDescription')} confirmLabel={t('restore')} onConfirm={() => void restore()} onClose={() => setRestoreTarget(null)} />}</>;
}
