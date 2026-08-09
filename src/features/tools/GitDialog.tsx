import { useState } from 'react';
import { ChevronDown, GitCommit, UploadCloud } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { GitStatus } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';
import { useLanguage } from '../../language';

export function GitDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<GitStatus | null>(null), [message, setMessage] = useState(''), [output, setOutput] = useState(''), [busy, setBusy] = useState(false);
  useFlushedEffect(flush, () => api.gitStatus().then(value => { setStatus(value); setMessage(value.vorschlag || ''); }).catch(error => setStatus({ ok: false, grund: errorMessage(error) })));
  const send = async (push: boolean) => { setBusy(true); setOutput(''); try { await flush(); const result = await api.gitCommit(message, push); setOutput((result.log || []).join('\n') || result.grund || t('done')); if (result.status) setStatus(result.status); } catch (error) { setOutput(errorMessage(error)); } finally { setBusy(false); } };
  return <Dialog title={t('gitSave')} onClose={onClose}>
    {!status ? <p>{t('loadingGitStatus')}</p> : !status.ok ? <div className="error-box" role="alert">{status.grund}</div> : <>
      <label className="field"><span>{t('commitMessage')}</span><textarea value={message} onChange={event => setMessage(event.target.value)} /></label>
      <div className="dialog-actions"><button disabled={busy || !message.trim()} onClick={() => void send(false)}><GitCommit />{t('commitOnly')}</button><button className="primary" disabled={busy || !message.trim() || !status.remote} onClick={() => void send(true)}><UploadCloud />{t('commitPush')}</button></div>
      {output && <pre className="git-output" role="status">{output}</pre>}<details className="utility-disclosure"><summary><ChevronDown />{t('gitTechnicalDetails')}</summary><dl className="git-facts"><div><dt>{t('branch')}</dt><dd>{status.branch}</dd></div><div><dt>{t('target')}</dt><dd>{status.upstream || status.remote || t('notConfigured')}</dd></div><div><dt>{t('changed')}</dt><dd>{status.anzahl || 0} {t('files')}</dd></div><div><dt>{t('notPushed')}</dt><dd>{status.unveroeffentlicht || 0} {t('commits')}</dd></div></dl>{!!status.aenderungen?.length && <div className="changed-files">{status.aenderungen.map(file => <code key={file}>{file}</code>)}</div>}</details>
    </>}
  </Dialog>;
}
