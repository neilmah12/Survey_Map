import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetSettings, Survey, ViewSettings } from '../types';
import { METRIC_LABEL, formatMetric } from '../lib/format';
import { filterOptions } from '../lib/groups';
import { computeSummary } from '../lib/summary';
import { fmtDiff, fmtValue } from '../lib/summaryFormat';
import { netDefinition, netOf } from '../lib/net';
import SummaryChart from './SummaryChart';
import ChoosePanel from './ChoosePanel';
import { appliedPills, availableMetrics, matching } from '../lib/choose';
import { fmtKm } from '../lib/scope';
import { pinNumbers } from '../lib/pinNumbers';

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
  /** The editor sets what counts toward net rent in its own strip, so the panel leaves that to it. */
  editable?: boolean;
  /** A client who is allowed to change what counts toward net rent does it in the panel. */
  onNet?: (n: NetSettings) => void;
}

const PHONE = '(max-width: 900px)';

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

export default function SummaryPanel({ survey, view, onView, canToggle, onToggleBuilding, onToggleUnit, unplaced = 0, editable = false, onNet }: Props) {
  const s = view.summary;
  // Not saved anywhere: the client file may not touch browser storage, so it opens collapsed each visit.
  const [expanded, setExpanded] = useState(false);
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

  const numbers = useMemo(() => pinNumbers(survey.buildings), [survey.buildings]);
  const subjects = survey.buildings.filter((b) => b.isSubject && !b.out);
  const comps = survey.buildings.filter((b) => !b.isSubject);
  // Nearest first (the same order as the numbers on the pins).
  const listed = [...comps].sort((a, b) => (numbers.get(a.id) ?? 9999) - (numbers.get(b.id) ?? 9999));
  const pills = appliedPills(view);
  const switchedOff = comps.filter((b) => b.excluded && b.out !== 'far');
  const counts = matching(survey, view.filters);
  const unit = s.perBuilding ? 'buildings' : 'units';
  const offCount = result.excludedUnits;

  // A measure the data cannot show (no square feet, nothing changing a rent) cannot stay chosen.
  const available = useMemo(() => availableMetrics(survey), [survey]);
  useEffect(() => {
    if (!available[view.metric]) onView({ ...view, metric: 'rate' });
  }, [available, view.metric]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hidden: a button on the map brings it back, so the options are never lost.
  if (!s.open)
    return (
      <button className="reopen" onClick={() => set({ open: true })}>
        Choose what to compare
      </button>
    );
  return (
    <div className={`summary-wrap${expanded ? ' expanded' : ''}`}>
    {phone ? <GrabBar expanded={expanded} onToggle={setExpanded} /> : <EdgeTab expanded={expanded} onToggle={() => setExpanded(!expanded)} />}
    <aside className="summary-panel" aria-label="Market summary">
      <div className="summary-head">
        <div>
          <div className="summary-title">Market summary</div>
          <div className="summary-sub">
            {METRIC_LABEL[view.metric]}, {s.stat === 'avg' ? 'average' : 'median'} of {result.marketBuildings} comparable building{result.marketBuildings === 1 ? '' : 's'}
            {subjects.length ? `, subject excluded` : ''}
          </div>
          {view.metric === 'net' && <div className="summary-sub">{netDefinition(netOf(survey))}</div>}
          <div className="applied" aria-label="Choices applied to these figures">
            <b>Based on:</b>
            {pills.length === 0 ? <span className="none">every unit type, any distance</span> : pills.map((x) => <span className="pill" key={x}>{x}</span>)}
            <span className="none">({result.marketBuildings} of {counts.total} comparable building{counts.total === 1 ? '' : 's'})</span>
            {canToggle && switchedOff.length > 0 && (
              <span className="none">
                {switchedOff.length} switched off{' '}
                <button className="link-btn" onClick={() => switchedOff.forEach((b) => onToggleBuilding?.(b.id))}>
                  Switch back on
                </button>
              </span>
            )}
          </div>
        </div>
        <button className="link-btn" onClick={() => set({ open: false })} aria-label="Hide the market summary">
          Hide
        </button>
      </div>

      <ChoosePanel survey={survey} view={view} onView={onView} editable={editable} onNet={onNet} phone={phone} expanded={expanded} onExpand={() => setExpanded(true)} />

      {comps.length > 0 && (
        <details className="summary-props near-list" open={canToggle || undefined}>
          <summary>{canToggle ? 'Buildings in the comparison' : 'Buildings and distances'}</summary>
          <p className="hint">
            {canToggle ? 'Untick a property, or a single suite, to take it out of the figures. It stays on the map, greyed. ' : ''}
            {subjects.length ? 'Distances are measured from the subject. ' : ''}
            Buildings beyond the chosen distance are greyed and not counted.
          </p>
          <ul>
            {listed.map((b) => {
              const far = b.out === 'far';
              const label = (
                <>
                  {numbers.has(b.id) && <span className="num-badge">{numbers.get(b.id)}</span>}
                  <span className={b.excluded || far ? 'off' : ''}>{b.name}</span>
                  {b.distKm != null && <span className="dist">{fmtKm(b.distKm)}</span>}
                </>
              );
              return (
                <li key={b.id}>
                  {canToggle ? (
                    <label className="check row">
                      <input type="checkbox" checked={!b.excluded && !far} disabled={far} onChange={() => onToggleBuilding?.(b.id)} />
                      {label}
                    </label>
                  ) : (
                    <div className="row">{label}</div>
                  )}
                  {canToggle && b.units.length > 1 && !far && (
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
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {!result.hasSubject && <p className="summary-note">Mark a subject property to compare it with the market.</p>}

      <div className="chart-block">
        <div className="chart-controls">
          <span className="control-label">Chart</span>
          <div className="seg" role="group" aria-label="Chart view">
            <button aria-pressed={s.chart === 'compare'} onClick={() => set({ chart: 'compare' })}>Compare</button>
            <button aria-pressed={s.chart === 'diff'} onClick={() => set({ chart: 'diff' })}>Difference %</button>
            <button aria-pressed={s.chart === 'off'} onClick={() => set({ chart: 'off' })}>Off</button>
          </div>
        </div>
        {s.chart !== 'off' && result.rows.length > 0 && <SummaryChart result={result} metric={view.metric} mode={s.chart} stat={s.stat} numbers={numbers} compact={phone && !expanded} />}
      </div>

      <details className="more-options">
        <summary>More options</summary>
        <div className="more-body">
          <div className="seg">
            <button aria-pressed={s.stat === 'avg'} onClick={() => set({ stat: 'avg' })}>Average</button>
            <button aria-pressed={s.stat === 'median'} onClick={() => set({ stat: 'median' })}>Median</button>
          </div>
          <label className="check" title="Off: every unit counts, so a building with three suites weighs three times">
            <input type="checkbox" checked={s.perBuilding} onChange={(e) => set({ perBuilding: e.target.checked })} />
            Each building counts once
          </label>
          {splits.length > 0 && (
            <div className="splits">
              <span className="control-label">Split rows by</span>
              {splits.map((o) => (
                <label key={o.k} className="check">
                  <input type="checkbox" checked={Boolean(s.split[o.k])} onChange={(e) => set({ split: { ...s.split, [o.k]: e.target.checked } })} />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </details>

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

    </aside>
    </div>
  );
}

const Chevron = ({ dir }: { dir: 'left' | 'right' | 'up' | 'down' }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ transform: `rotate(${{ left: 0, up: 90, right: 180, down: 270 }[dir]}deg)` }}>
    <path d="M9 2.5 4.5 7 9 11.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Desktop: a tab on the drawer's left edge. The arrow points the way the drawer will move. */
function EdgeTab({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const label = expanded ? 'Make the summary narrower' : 'Make the summary wider';
  return (
    <button className="panel-handle" onClick={onToggle} aria-expanded={expanded} aria-label={label} title={label}>
      <Chevron dir={expanded ? 'right' : 'left'} />
    </button>
  );
}

/** Phone: a bar across the top of the drawer. Tap it, or drag it up or down. */
function GrabBar({ expanded, onToggle }: { expanded: boolean; onToggle: (v: boolean) => void }) {
  const start = useRef<number | null>(null);
  const label = expanded ? 'Back to the map' : 'Show the summary full screen';
  return (
    <button
      className="panel-grab"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        start.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        if (from == null) return;
        const dy = e.clientY - from;
        if (Math.abs(dy) < 10) onToggle(!expanded); // a tap
        else onToggle(dy < 0); // up opens it, down closes it
      }}
      onPointerCancel={() => { start.current = null; }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(!expanded); } }}
    >
      <Chevron dir={expanded ? 'down' : 'up'} />
      <span className="grab-pill" />
    </button>
  );
}
