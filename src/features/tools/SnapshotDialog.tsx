import { useState } from 'react';
import { ChevronDown, Save, UploadCloud } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { BackupStatus } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';
import { describePath, changedPath } from '../../lib/pathNames';

export function SnapshotDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<BackupStatus | null>(null), [message, setMessage] = useState(''), [output, setOutput] = useState(''), [busy, setBusy] = useState(false);
  useFlushedEffect(flush, () => api.backupStatus().then(value => { setStatus(value); setMessage(value.vorschlag || ''); }).catch(error => setStatus({ ok: false, grund: errorMessage(error) })));
  const send = async (upload: boolean) => { setBusy(true); setOutput(''); try { await flush(); const result = await api.saveSnapshot(message, upload); setOutput((result.log || []).join('\n') || result.grund || t('done')); if (result.status) setStatus(result.status); } catch (error) { setOutput(errorMessage(error)); } finally { setBusy(false); } };
  return <Dialog title={t('snapshotSave')} onClose={onClose}>
    {!status ? <p>{t('loadingBackupStatus')}</p> : !status.ok ? <div className="error-box" role="alert">{status.grund}</div> : <>
      <label className="field"><span>{t('snapshotMessage')}</span><textarea value={message} onChange={event => setMessage(event.target.value)} /></label>
      <div className="dialog-actions"><button disabled={busy || !message.trim()} onClick={() => void send(false)}><Save />{t('saveOnly')}</button><button className="primary" disabled={busy || !message.trim() || !status.endpoint} onClick={() => void send(true)}><UploadCloud />{t('saveAndUpload')}</button></div>
      {output && <pre className="git-output" role="status">{output}</pre>}<details className="utility-disclosure"><summary><ChevronDown />{t('technicalDetails')}</summary><dl className="git-facts"><div><dt>{t('target')}</dt><dd>{status.endpoint || t('notConfigured')}</dd></div><div><dt>{t('changed')}</dt><dd>{status.anzahl || 0} {t('files')}</dd></div></dl>{!!status.aenderungen?.length && <div className="changed-files">{status.aenderungen.map(line => { const { kind, title } = describePath(changedPath(line)); const label = kind === 'chapter' ? t('chapter') : kind === 'profile' ? t('profile') : kind === 'database' ? t('database') : null; return <code key={line}>{label ? `${label}: ${title}` : title}</code>; })}</div>}</details>
    </>}
  </Dialog>;
}
