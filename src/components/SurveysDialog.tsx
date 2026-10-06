import { useEffect, useState } from 'react';
import { deleteSurvey, listSurveys, type CloudEntry } from '../lib/cloud';

interface Props {
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

const when = (d: Date | null) => (d ? d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** The team's saved surveys. Opening one replaces what is on screen (the current survey is saved first). */
export default function SurveysDialog({ currentId, onOpen, onClose, onDeleted }: Props) {
  const [items, setItems] = useState<CloudEntry[] | null>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    listSurveys().then(setItems).catch(() => setError('Could not load the list. Check your connection.'));
  }, []);

  const remove = async (id: string) => {
    try {
      await deleteSurvey(id);
      setItems((l) => l && l.filter((x) => x.id !== id));
      setConfirmId(null);
      onDeleted(id);
    } catch {
      setError('Could not delete that survey.');
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Saved surveys">
      <div className="modal wide">
        <h2>Saved surveys</h2>
        {error && <p className="error">{error}</p>}
        {!items && !error && <p className="hint">Loading...</p>}
        {items && items.length === 0 && <p className="hint">Nothing saved yet. Your work saves here automatically.</p>}
        {items && items.length > 0 && (
          <ul className="survey-list">
            {items.map((s) => (
              <li key={s.id}>
                <div className="survey-list-main">
                  <strong>{s.title || 'Untitled survey'}</strong>
                  {s.id === currentId && <span className="notice"> (open now)</span>}
                  {s.publishedId && <span className="notice"> (published)</span>}
                  <div className="hint">{s.location} {s.location ? '· ' : ''}{s.buildings} buildings · saved {when(s.updatedAt)} by {s.updatedBy}</div>
                </div>
                {confirmId === s.id ? (
                  <span className="row-actions">
                    <button className="btn danger" onClick={() => remove(s.id)}>Delete for everyone</button>
                    <button className="btn" onClick={() => setConfirmId(null)}>Keep</button>
                  </span>
                ) : (
                  <span className="row-actions">
                    <button className="btn primary" disabled={s.id === currentId} onClick={() => onOpen(s.id)}>Open</button>
                    <button className="btn" onClick={() => setConfirmId(s.id)}>Delete</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
