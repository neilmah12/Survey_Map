import { useEffect, useMemo, useState } from 'react';
import type { Survey, ViewSettings } from '../types';
import { METRIC_LABEL, formatMetric } from '../lib/format';
import { filterOptions } from '../lib/groups';
import { computeSummary } from '../lib/summary';
import { fmtDiff, fmtValue } from '../lib/summaryFormat';
import { netDefinition, netOf } from '../lib/net';
import SummaryChart from './SummaryChart';

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

const EXPANDED_KEY = 'survey-map:summary-expanded';
const PHONE = '(max-width: 900px)';

/** Remembered on this device only: it is how someone likes to look at the panel, not part of the survey. */
function useExpanded(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(EXPANDED_KEY, v ? '1' : '0');
    } catch {
      /* private window or blocked storage: it just is not remembered */
    }
  };
  return [on, set];
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(PHONE);
    const f = () => setPhone(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return phone;
}

export default function SummaryPanel({ survey, view, onView, canToggle, onToggleBuilding, onToggleUnit, unplaced = 0 }: Props) {
  const s = view.summary;
  const [expanded, setExpanded] = useExpanded();
  const phone = usePhone();
  const result = useMemo(
    () => computeSummary(survey, { metric: view.metric, filters: view.filters, settings: s }),
    [survey, view.metric, view.filters, s],
  );
  const options = useMemo(() => filterOptions(survey), [survey]);
  const set = (patch: Partial<typeof s>) => onView({ ...view, summary: { ...s, ...patch } });
  type SplitKey = keyof typeof s.split;
  const allSplits: { k: SplitKey; label: string }[] = [
    { k: 'kind', label: 'Property type' },
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
    <aside className={`summary-panel${expanded ? ' expanded' : ''}`} aria-label="Market summary">
      <div className="summary-head">
        <div>
          <div className="summary-title">Market summary</div>
          <div className="summary-sub">
            {METRIC_LABEL[view.metric]}, {s.stat === 'avg' ? 'average' : 'median'} of {result.marketBuildings} comparable building{result.marketBuildings === 1 ? '' : 's'}
            {subjects.length ? `, subject excluded` : ''}
          </div>
          {view.metric === 'net' && <div className="summary-sub">{netDefinition(netOf(survey))}</div>}
        </div>
        <div className="summary-actions">
          <button className="link-btn" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} title={expanded ? 'Back to the smaller panel' : phone ? 'Show the summary full screen' : 'Make the panel wider'}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button className="link-btn" onClick={() => set({ open: false })} aria-label="Hide the market summary">
            Hide
          </button>
        </div>
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
        <div className="chart-controls">
          <span className="control-label">Chart</span>
          <div className="seg" role="group" aria-label="Chart view">
            <button className={s.chart === 'compare' ? 'on' : ''} onClick={() => set({ chart: 'compare' })}>Compare</button>
            <button className={s.chart === 'diff' ? 'on' : ''} onClick={() => set({ chart: 'diff' })}>Difference %</button>
            <button className={s.chart === 'off' ? 'on' : ''} onClick={() => set({ chart: 'off' })}>Off</button>
          </div>
          {s.chart === 'compare' && (
            <label className="check" title="A dot for each comparable building, so a spread is not hidden behind the average">
              <input type="checkbox" checked={s.dots} onChange={(e) => set({ dots: e.target.checked })} />
              Show each comp
            </label>
          )}
        </div>
        {splits.length > 0 && (
          <div className="splits">
            <span className="control-label">Split by</span>
            {splits.map((o) => (
              <label key={o.k} className="check">
                <input type="checkbox" checked={Boolean(s.split[o.k])} onChange={(e) => set({ split: { ...s.split, [o.k]: e.target.checked } })} />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {!result.hasSubject && <p className="summary-note">Mark a subject property to compare it with the market.</p>}

      {s.chart !== 'off' && result.rows.length > 0 && <SummaryChart result={result} metric={view.metric} mode={s.chart} dots={s.dots} stat={s.stat} compact={phone && !expanded} />}

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
            {result.rows.map((r) => (
              <tr key={r.key}>
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
