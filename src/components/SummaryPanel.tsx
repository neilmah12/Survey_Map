import { useMemo } from 'react';
import type { Survey, ViewSettings } from '../types';
import { METRIC_LABEL, formatMetric } from '../lib/format';
import { filterOptions } from '../lib/groups';
import { computeSummary } from '../lib/summary';
import { fmtDiff, fmtValue } from '../lib/summaryFormat';

interface Props {
  /** Only buildings that are on the map: the client file leaves out the rest, so the numbers must too. */
  survey: Survey;
  view: ViewSettings;
  onView: (v: ViewSettings) => void;
  /** Show the list that switches properties and suites on and off. */
  canToggle: boolean;
  onToggleBuilding?: (id: string) => void;
  onToggleUnit?: (buildingId: string, unitId: string) => void;
  /** Editor only: buildings left out because they have no pin yet. */
  unplaced?: number;
}

export default function SummaryPanel({ survey, view, onView, canToggle, onToggleBuilding, onToggleUnit, unplaced = 0 }: Props) {
  const s = view.summary;
  const result = useMemo(
    () => computeSummary(survey, { metric: view.metric, filters: view.filters, settings: s }),
    [survey, view.metric, view.filters, s],
  );
  const options = useMemo(() => filterOptions(survey), [survey]);
  const set = (patch: Partial<typeof s>) => onView({ ...view, summary: { ...s, ...patch } });
  type SplitKey = keyof typeof s.split;
  const allSplits: { k: SplitKey; label: string }[] = [
    { k: 'baths', label: 'Bathrooms' },
    { k: 'reno', label: 'Renovation' },
  ];
  // Offer a split only when the data has at least two values for it (or it is already on).
  const splits = allSplits.filter(({ k }) => options[k].length > 0 || s.split[k]);

  const subjects = survey.buildings.filter((b) => b.isSubject);
  const comps = survey.buildings.filter((b) => !b.isSubject);
  const unit = s.perBuilding ? 'buildings' : 'units';
  const offCount = result.excludedUnits;

  if (!s.open) return null;
  return (
    <aside className="summary-panel" aria-label="Market summary">
      <div className="summary-head">
        <div>
          <div className="summary-title">Market summary</div>
          <div className="summary-sub">
            {METRIC_LABEL[view.metric]}, {s.stat === 'avg' ? 'average' : 'median'} of {result.marketBuildings} comparable building{result.marketBuildings === 1 ? '' : 's'}
            {subjects.length ? `, subject excluded` : ''}
          </div>
        </div>
        <button className="link-btn" onClick={() => set({ open: false })} aria-label="Hide the market summary">
          Hide
        </button>
      </div>

      <div className="summary-controls">
        <div className="seg">
          <button className={s.stat === 'avg' ? 'on' : ''} onClick={() => set({ stat: 'avg' })}>Average</button>
          <button className={s.stat === 'median' ? 'on' : ''} onClick={() => set({ stat: 'median' })}>Median</button>
        </div>
        <label className="check" title="Off: every unit counts, so a building with three suites weighs three times">
          <input type="checkbox" checked={s.perBuilding} onChange={(e) => set({ perBuilding: e.target.checked })} />
          Each building counts once
        </label>
        {splits.length > 0 && (
          <div className="splits">
            <span className="control-label">Split by</span>
            {splits.map((o) => (
              <label key={o.k} className="check">
                <input type="checkbox" checked={s.split[o.k]} onChange={(e) => set({ split: { ...s.split, [o.k]: e.target.checked } })} />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {!result.hasSubject && <p className="summary-note">Mark a subject property to compare it with the market.</p>}

      {result.rows.length === 0 ? (
        <p className="summary-note">Nothing to compare with the current filters.</p>
      ) : (
        <table className="summary-table">
          <thead>
            <tr>
              <th>Unit type</th>
              <th className="num" title={`Number of ${unit} behind the market figure`}>Comps</th>
              <th className="num">Market</th>
              {result.hasSubject && <th className="num">Subject</th>}
              {result.hasSubject && <th className="num">Difference</th>}
            </tr>
          </thead>
          <tbody>
            {[...result.rows, result.total].map((r) => (
              <tr key={r.key} className={r.key === '__all__' ? 'total' : ''}>
                <td>{r.label}</td>
                <td className="num muted">{r.market.n || '-'}</td>
                <td className="num">{fmtValue(r.market, view.metric)}</td>
                {result.hasSubject && <td className="num">{fmtValue(r.subject, view.metric)}</td>}
                {result.hasSubject && <td className="num diff">{fmtDiff(r, view.metric)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="summary-foot">
        {s.perBuilding ? 'Each building counts once, using its own average for that unit type. ' : 'Every unit counts. '}
        {subjects.length > 1 ? `The subject is the average of ${subjects.length} properties. ` : ''}
        {offCount > 0 ? `${offCount} unit${offCount === 1 ? ' is' : 's are'} switched off and not counted. ` : ''}
        {unplaced > 0 ? `${unplaced} building${unplaced === 1 ? ' has' : 's have'} no pin yet and ${unplaced === 1 ? 'is' : 'are'} not counted.` : ''}
      </p>

      {canToggle && comps.length > 0 && (
        <details className="summary-props">
          <summary>Properties in the comparison</summary>
          <p className="hint">Untick a property, or a single suite, to take it out of the figures. It stays on the map, greyed.</p>
          <ul>
            {comps.map((b) => (
              <li key={b.id}>
                <label className="check">
                  <input type="checkbox" checked={!b.excluded} onChange={() => onToggleBuilding?.(b.id)} />
                  <span className={b.excluded ? 'off' : ''}>{b.name}</span>
                </label>
                {b.units.length > 1 && (
                  <ul className="units-off">
                    {b.units.map((u) => (
                      <li key={u.id}>
                        <label className="check">
                          <input type="checkbox" checked={!b.excluded && !u.excluded} disabled={b.excluded} onChange={() => onToggleUnit?.(b.id, u.id)} />
                          <span className={b.excluded || u.excluded ? 'off' : ''}>
                            {u.type || 'Unit'}
                            {u.rate != null ? ` · ${formatMetric(u.rate, 'rate')}` : ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {b.units.length === 1 && null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
