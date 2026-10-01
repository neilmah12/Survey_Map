import type { Survey, ViewSettings, Metric } from '../types';
import { METRIC_LABEL, allBeds, bedLabel } from '../lib/format';

interface Props {
  survey: Survey;
  view: ViewSettings;
  onChange: (v: ViewSettings) => void;
  /** Edit mode exposes ring distances; the client view only toggles them. */
  editable: boolean;
}

export default function Controls({ survey, view, onChange, editable }: Props) {
  const beds = allBeds(survey.buildings);
  const hasSubject = survey.buildings.some((b) => b.isSubject);
  const toggleBed = (n: number) =>
    onChange({ ...view, beds: view.beds.includes(n) ? view.beds.filter((x) => x !== n) : [...view.beds, n] });

  return (
    <div className="controls">
      <div className="control-group">
        <div className="control-label">Show</div>
        <div className="seg">
          {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
            <button key={m} className={view.metric === m ? 'on' : ''} onClick={() => onChange({ ...view, metric: m })}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {beds.length > 1 && (
        <div className="control-group">
          <div className="control-label">Unit type</div>
          <div className="chips">
            <button className={view.beds.length === 0 ? 'chip on' : 'chip'} onClick={() => onChange({ ...view, beds: [] })}>
              All
            </button>
            {beds.map((n) => (
              <button key={n} className={view.beds.includes(n) ? 'chip on' : 'chip'} onClick={() => toggleBed(n)}>
                {bedLabel(n)}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasSubject && (
        <div className="control-group">
          <label className="check">
            <input type="checkbox" checked={view.rings} onChange={(e) => onChange({ ...view, rings: e.target.checked })} />
            Distance rings from subject
          </label>
          {editable && view.rings && (
            <input
              className="rings-input"
              aria-label="Ring distances in km"
              defaultValue={view.ringsKm.join(', ')}
              onBlur={(e) => {
                const km = e.target.value
                  .split(/[,\s]+/)
                  .map(parseFloat)
                  .filter((n) => n > 0 && n <= 50);
                if (km.length) onChange({ ...view, ringsKm: km });
              }}
              title="Comma-separated distances in km"
            />
          )}
        </div>
      )}
    </div>
  );
}
