import { useState } from 'react';
import { GitCommit, UploadCloud } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { GitStatus } from '../../types';
import { Dialog } from '../../shared/ui/Dialog';
import { useFlushedEffect } from '../../hooks/useFlushedEffect';

export function GitDialog({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> }) {
  const [status, setStatus] = useState<GitStatus | null>(null), [message, setMessage] = useState(''), [output, setOutput] = useState(''), [busy, setBusy] = useState(false);
  useFlushedEffect(flush, () => api.gitStatus().then(value => { setStatus(value); setMessage(value.vorschlag || ''); }).catch(error => setStatus({ ok: false, grund: errorMessage(error) })));
  const send = async (push: boolean) => { setBusy(true); setOutput(''); try { await flush(); const result = await api.gitCommit(message, push); setOutput((result.log || []).join('\n') || result.grund || 'Fertig.'); if (result.status) setStatus(result.status); } catch (error) { setOutput(errorMessage(error)); } finally { setBusy(false); } };
  return <Dialog title="Git · Arbeitsstand sichern" onClose={onClose}>
    {!status ? <p>Lade Git-Status …</p> : !status.ok ? <div className="error-box">{status.grund}</div> : <>
      <dl className="git-facts"><div><dt>Branch</dt><dd>{status.branch}</dd></div><div><dt>Ziel</dt><dd>{status.upstream || status.remote || 'Nicht eingerichtet'}</dd></div><div><dt>Geändert</dt><dd>{status.anzahl || 0} Dateien</dd></div><div><dt>Nicht gepusht</dt><dd>{status.unveroeffentlicht || 0} Commits</dd></div></dl>
      {!!status.aenderungen?.length && <div className="changed-files">{status.aenderungen.map(file => <code key={file}>{file}</code>)}</div>}
      <label className="field"><span>Commit-Nachricht</span><textarea value={message} onChange={event => setMessage(event.target.value)} /></label>
      <div className="dialog-actions"><button disabled={busy || !message.trim()} onClick={() => void send(false)}><GitCommit />Nur committen</button><button className="primary" disabled={busy || !message.trim() || !status.remote} onClick={() => void send(true)}><UploadCloud />Committen & pushen</button></div>
      {output && <pre className="git-output">{output}</pre>}
    </>}
  </Dialog>;
}
