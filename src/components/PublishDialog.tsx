import { useEffect, useMemo, useState } from 'react';
import { ChecksList } from './ChecksDialog';
import { countBySeverity, type Check } from '../lib/checks';
import { getPublishState, publishedUrl, publishSnapshot, unpublishSurvey, type PublishState } from '../lib/publish';
import { summarizeSnapshot, type SnapshotResult } from '../lib/snapshot';
import { localDate, offeredAsOf } from '../lib/dates';
import { formatDate } from '../lib/format';

interface Props {
  surveyId: string;
  result: SnapshotResult;
  checks: Check[];
  onShow: (buildingId: string) => void;
  onClose: () => void;
  onDone: (text: string) => void;
  /** The date chosen here becomes the survey's As of date too, so the editor and the link agree. */
  onAsOf: (date: string) => void;
  /** Same for the choice to let clients switch buildings on and off. */
  onClientToggle: (on: boolean) => void;
  /** Same for letting clients download the PDF report. */
  onClientPdf: (on: boolean) => void;
}

const when = (d: Date | null) => (d ? d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Publish, update or unpublish the private client link for the survey that is open. */
export default function PublishDialog({ surveyId, result, checks, onShow, onClose, onDone, onAsOf, onClientToggle, onClientPdf }: Props) {
  const [state, setState] = useState<PublishState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  // The As of date clients will see. It starts as the survey's own date; when there is something new to publish it
  // moves to today (one click to change it back), so a link sent today does not read as an old update.
  const today = localDate();
  const [asOf, setAsOf] = useState(result.snapshot.asOf);
  const [asOfTouched, setAsOfTouched] = useState(false);
  const [canToggle, setCanToggle] = useState(Boolean(result.snapshot.clientCanToggle));
  const [canPdf, setCanPdf] = useState(Boolean(result.snapshot.clientCanDownload));
  const snap = useMemo(() => {
    const next = { ...result.snapshot, asOf };
    if (canToggle) next.clientCanToggle = true;
    else delete next.clientCanToggle;
    if (canPdf) next.clientCanDownload = true;
    else delete next.clientCanDownload;
    return next;
  }, [result, asOf, canToggle, canPdf]);
  const sum = summarizeSnapshot(result);
  const counts = countBySeverity(checks);
  const issues = checks.filter((c) => c.severity !== 'info');

  useEffect(() => {
    getPublishState(surveyId, snap).then(setState).catch(() => setError('Could not check the current link. Check your connection.'));
  }, [surveyId, snap]);

  useEffect(() => {
    if (state && !asOfTouched) {
      setAsOf(offeredAsOf(state.published, state.upToDate, asOf, today));
      setAsOfTouched(true);
    }
  }, [state, asOfTouched, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setState(await getPublishState(surveyId, snap));
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
            {!confirmOff && (
              <div className="asof-row">
                <label className="field">
                  <span>As of date clients will see</span>
                  <input
                    type="date"
                    value={asOf}
                    onChange={(e) => {
                      setAsOf(e.target.value);
                      setAsOfTouched(true);
                    }}
                  />
                </label>
                {asOf !== today && (
                  <button className="link-btn" onClick={() => { setAsOf(today); setAsOfTouched(true); }}>
                    Use today ({formatDate(today)})
                  </button>
                )}
              </div>
            )}
            {!confirmOff && (
              <label className="check" title="Off: clients see your selection and cannot change it. On: they get a tick box per building, in the summary and on each map popup. Their choices are never saved.">
                <input type="checkbox" checked={canToggle} onChange={(e) => setCanToggle(e.target.checked)} />
                Clients can switch buildings on and off
              </label>
            )}
            {!confirmOff && (
              <label className="check" title="Adds a Download PDF button to the client page. The PDF is always this published version (the map, every rent type and your contact details), not whatever the client has clicked. It is a picture of the pages: the numbers cannot be copied out.">
                <input type="checkbox" checked={canPdf} onChange={(e) => setCanPdf(e.target.checked)} />
                Clients can download a PDF of this report
              </label>
            )}
            {!confirmOff && <p className="hint">Today's date is the usual choice when you have just checked or updated the rents. Choose an earlier date only if the rents were collected then.</p>}
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
                  disabled={busy || !asOf || counts.error > 0 || (state.published && state.upToDate === true)}
                  onClick={() => run(async () => { await publishSnapshot(surveyId, { ...snap, publishedAt: new Date().toISOString() }); onAsOf(asOf); onClientToggle(canToggle); onClientPdf(canPdf); }, state.published ? 'Client link updated.' : 'Published. Copy the link from the Client link dialog.')}
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
