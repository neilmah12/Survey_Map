import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ClientViewer from '../components/ClientViewer';
import { isSnapshot, snapshotToSurvey, snapshotToView, type ClientSnapshot } from '../lib/snapshot';
import { fetchPhoto, fetchPublished } from '../lib/publishedRead';
import { setPhotoLoader } from '../lib/photoSource';
import '../styles.css';

// The client page. It has no editing code and stores nothing. It shows a snapshot that is either embedded in
// the file (the "Export client file" copy) or loaded by id from the address /s/<id> (the published link).
function embeddedSnapshot(): ClientSnapshot | null {
  try {
    const parsed = JSON.parse(document.getElementById('survey-snapshot')?.textContent ?? '');
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const idFromAddress = () => /^\/s\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? new URLSearchParams(window.location.search).get('id') ?? '';

type State = { kind: 'loading' } | { kind: 'ok'; snapshot: ClientSnapshot } | { kind: 'missing' } | { kind: 'error' };

function Message({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <div className="empty">
      <h1>{title}</h1>
      <p>{text}</p>
      {retry && <button className="btn primary" onClick={retry}>Try again</button>}
    </div>
  );
}

function Page() {
  const [state, setState] = useState<State>(() => {
    const s = embeddedSnapshot();
    return s ? { kind: 'ok', snapshot: s } : { kind: 'loading' };
  });

  const load = useCallback(async () => {
    const id = idFromAddress();
    setState({ kind: 'loading' });
    const r = await fetchPublished(id);
    if (r.status === 'ok') {
      setPhotoLoader((photoId) => fetchPhoto(id, photoId));
      setState({ kind: 'ok', snapshot: r.snapshot });
    } else setState({ kind: r.status });
  }, []);

  useEffect(() => {
    if (state.kind === 'loading') void load();
  }, []);

  useEffect(() => {
    if (state.kind === 'ok') document.title = `${state.snapshot.title} | Rental Market Survey`;
  }, [state]);

  if (state.kind === 'loading') return <Message title="Loading survey" text="One moment..." />;
  if (state.kind === 'missing') return <Message title="Survey not available" text="This link is not active. It may have been withdrawn or mistyped. Contact the person who sent it." />;
  if (state.kind === 'error') return <Message title="Could not load the survey" text="Check your connection and try again." retry={load} />;
  return <ClientViewer survey={snapshotToSurvey(state.snapshot)} initialView={snapshotToView(state.snapshot)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
