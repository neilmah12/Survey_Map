import { useEffect, useState } from 'react';
import { ChecksList } from './ChecksDialog';
import { countBySeverity, type Check } from '../lib/checks';
import { getPublishState, publishedUrl, publishSnapshot, unpublishSurvey, type PublishState } from '../lib/publish';
import { summarizeSnapshot, type SnapshotResult } from '../lib/snapshot';

interface Props {
  surveyId: string;
  result: SnapshotResult;
  checks: Check[];
  onShow: (buildingId: string) => void;
  onClose: () => void;
  onDone: (text: string) => void;
}

const when = (d: Date | null) => (d ? d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Publish, update or unpublish the private client link for the survey that is open. */
export default function PublishDialog({ surveyId, result, checks, onShow, onClose, onDone }: Props) {
  const [state, setState] = useState<PublishState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const sum = summarizeSnapshot(result);
  const counts = countBySeverity(checks);
  const issues = checks.filter((c) => c.severity !== 'info');

  useEffect(() => {
    getPublishState(surveyId, result.snapshot).then(setState).catch(() => setError('Could not check the current link. Check your connection.'));
  }, [surveyId, result]);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setState(await getPublishState(surveyId, result.snapshot));
      onDone(done);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not work. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const url = state?.id && state.published ? publishedUrl(state.id) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy. Select the link and copy it by hand.');
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Publish client link">
      <div className="modal wide">
        <h2>Client link</h2>
        {!state && !error && <p className="hint">Checking...</p>}
        {state && (
          <>
            <p>
              The link shows <strong>{sum.buildings} buildings ({sum.units} units)</strong>
              {sum.photos ? ` and ${sum.photos} photo${sum.photos === 1 ? '' : 's'}` : ''}, exactly as the client preview does. No login is needed, and
              it cannot edit anything. Anyone who has the link can open it, so send it only to the client.
            </p>
            {issues.length > 0 ? (
              <div className="export-checks">
                <ChecksList checks={issues} onShow={onShow} />
              </div>
            ) : (
              <p className="check-ok">Checks passed.</p>
            )}
            {state.published && (
              <div className="publish-link">
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Client link" />
                <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open</a>
              </div>
            )}
            {state.published && (
              <p className={state.upToDate === false ? 'notice warn' : 'hint'}>
                {state.upToDate === false ? 'The link shows an older version. ' : 'The link is up to date. '}
                Published {when(state.publishedAt)}.
              </p>
            )}
            {!state.published && state.id && <p className="hint">This survey was published before and unpublished. Publishing again reuses the same link.</p>}
            {error && <p className="error">{error}</p>}
            {confirmOff ? (
              <div className="row-actions">
                <span>Take the link down? Anyone who opens it will see "not available".</span>
                <button className="btn danger" disabled={busy} onClick={() => run(async () => { await unpublishSurvey(surveyId); setConfirmOff(false); }, 'Unpublished. The link no longer works.')}>Unpublish</button>
                <button className="btn" onClick={() => setConfirmOff(false)}>Keep it live</button>
              </div>
            ) : (
              <div className="row-actions">
                <button
                  className="btn primary"
                  disabled={busy || counts.error > 0 || (state.published && state.upToDate === true)}
                  onClick={() => run(async () => void (await publishSnapshot(surveyId, { ...result.snapshot, publishedAt: new Date().toISOString() })), state.published ? 'Client link updated.' : 'Published. Copy the link from the Client link dialog.')}
                >
                  {busy ? 'Working...' : state.published ? 'Update link' : counts.warn ? 'Publish anyway' : 'Publish'}
                </button>
                {state.published && <button className="btn" disabled={busy} onClick={() => setConfirmOff(true)}>Unpublish</button>}
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            )}
          </>
        )}
        {!state && error && (
          <>
            <p className="error">{error}</p>
            <div className="row-actions"><button className="btn" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
