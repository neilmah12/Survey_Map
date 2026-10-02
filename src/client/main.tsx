import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ClientViewer from '../components/ClientViewer';
import { isSnapshot, snapshotToSurvey, snapshotToView } from '../lib/snapshot';
import '../styles.css';

// The client page: reads the survey snapshot embedded in the file. It has no editing code and stores nothing.
function readSnapshot() {
  try {
    const raw = document.getElementById('survey-snapshot')?.textContent ?? '';
    const parsed = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const snapshot = readSnapshot();
if (snapshot) document.title = `${snapshot.title} | Rental Market Survey`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {snapshot ? (
      <ClientViewer survey={snapshotToSurvey(snapshot)} initialView={snapshotToView(snapshot)} />
    ) : (
      <div className="empty">
        <h1>Survey not available</h1>
        <p>This file does not contain survey data.</p>
      </div>
    )}
  </StrictMode>,
);
