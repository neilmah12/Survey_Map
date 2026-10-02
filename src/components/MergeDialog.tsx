import type { MergeSummary } from '../lib/merge';

interface Props {
  fileName: string;
  summary: MergeSummary;
  onApply: () => void;
  onCancel: () => void;
}

export default function MergeDialog({ fileName, summary: s, onApply, onCancel }: Props) {
  const unchanged = s.changed.length === 0 && s.added.length === 0 && s.removed.length === 0;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Update from Excel">
      <div className="modal">
        <h2>Update from {fileName}</h2>
        {s.looksDifferent && (
          <div className="alert">
            Only {s.matched} building{s.matched === 1 ? '' : 's'} matched. This may be a different survey. Applying will
            remove the pins and photos of the buildings that did not match.
          </div>
        )}
        <p className="modal-line">
          {s.matched} matched building{s.matched === 1 ? '' : 's'}: {s.pinsKept} pin{s.pinsKept === 1 ? '' : 's'} and{' '}
          {s.photosKept} photo{s.photosKept === 1 ? '' : 's'} kept.
        </p>
        {unchanged && <p className="modal-line">No changes in the sheet's buildings or rents.</p>}

        {s.changed.length > 0 && (
          <section>
            <h3>Updated from the sheet</h3>
            <ul>
              {s.changed.map((c) => (
                <li key={c.name}>
                  <strong>{c.name}</strong>
                  <ul>
                    {c.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}
        {s.added.length > 0 && (
          <section>
            <h3>New buildings (need a pin)</h3>
            <ul>{s.added.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}
        {s.keptLocal.length > 0 && (
          <section>
            <h3>Kept (added in the app, not in the sheet yet)</h3>
            <ul>{s.keptLocal.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}
        {s.removed.length > 0 && (
          <section>
            <h3>Removed (not in the sheet)</h3>
            <ul>{s.removed.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}
        {s.repositioned.length > 0 && (
          <section>
            <h3>Pins moved to the sheet's coordinates</h3>
            <ul>{s.repositioned.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}

        <p className="hint">You can undo this after applying.</p>
        <div className="row-actions">
          <button className="btn primary" onClick={onApply}>Apply update</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
