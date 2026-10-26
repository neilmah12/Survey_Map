import { useEffect, useMemo, useRef, useState } from 'react';
import type { Survey, ViewSettings, Metric, NetSettings } from '../types';
import { METRIC_LABEL } from '../lib/format';
import { NET_PARTS, netAvailable, netDefinition, netOf, partsWithData } from '../lib/net';
import { NO_FILTERS, filterOptions, isFiltering, kindContext, visibleUnits } from '../lib/groups';
import type { UnitFilters } from '../lib/groups';

export const DEFAULT_RINGS = [0.5, 1, 2];

/** Suggests a distance a little beyond the largest ring. */
const nextRing = (rings: number[]) => (rings.length ? Math.round((Math.max(...rings) + 1) * 10) / 10 : 1);

/** Editable ring distance. Keeps its own text so partial input like "1." is allowed; commits valid values. */
function RingInput({ km, onCommit, onRemove }: { km: number; onCommit: (v: number) => void; onRemove: () => void }) {
  const [text, setText] = useState(String(km));
  const focused = useRef(false);
  // Follow outside changes (reset, add), but never rewrite what the user is typing.
  useEffect(() => {
    if (!focused.current) setText(String(km));
  }, [km]);
  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0 && n <= 50) onCommit(Math.round(n * 100) / 100);
  };
  return (
    <span className="ring-item">
      <input
        inputMode="decimal"
        aria-label="Ring distance in km"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(String(km));
        }}
      />
      <span>km</span>
      <button aria-label="Remove ring" onClick={onRemove}>
        x
      </button>
    </span>
  );
}

interface Props {
  survey: Survey;
  view: ViewSettings;
  onChange: (v: ViewSettings) => void;
  /** Edit mode exposes ring distances; the client view only toggles them. */
  editable: boolean;
  /** Changes what counts toward net rent (saved with the survey in the editor, local in the client page). */
  onNet?: (n: NetSettings) => void;
}

export default function Controls({ survey, view, onChange, editable, onNet }: Props) {
  const options = useMemo(() => filterOptions(survey), [survey]);
  const net = netOf(survey);
  // Only offer a measure the data can show: no net rent without parking, utilities, incentive or misc amounts, no PSF without SF.
  const available = useMemo(() => {
    const units = survey.buildings.flatMap((b) => b.units);
    return { rate: true, psf: units.some((u) => u.rate != null && u.sf), net: netAvailable(survey) } as Record<Metric, boolean>;
  }, [survey]);
  const withData = useMemo(() => partsWithData(survey), [survey]);
  const setNet = (patch: Partial<NetSettings>) => onNet?.({ ...net, ...patch });
  // The client only sees tick boxes for what the survey has data for, and only if the editor allowed it.
  const netParts = NET_PARTS.filter((p) => editable || withData.has(p.k));
  const showNetBox = editable ? true : net.enabled && net.clientCanChange && view.metric === 'net' && netParts.length > 0 && Boolean(onNet);
  useEffect(() => {
    if (!available[view.metric]) onChange({ ...view, metric: 'rate' });
  }, [available, view.metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasSubject = survey.buildings.some((b) => b.isSubject);
  const toggle = (k: keyof UnitFilters, v: string) => {
    const cur = view.filters[k];
    onChange({ ...view, filters: { ...view.filters, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } });
  };
  const sections: { k: keyof UnitFilters; label: string }[] = [
    { k: 'beds', label: 'Bedrooms' },
    { k: 'baths', label: 'Bathrooms' },
    { k: 'reno', label: 'Renovation' },
  ];
  const active = isFiltering(view.filters);
  const ctx = useMemo(() => kindContext(survey), [survey]);
  const shown = useMemo(
    () => survey.buildings.filter((b) => visibleUnits(b, { filters: view.filters, ctx }).length > 0).length,
    [survey, view.filters, ctx],
  );

  return (
    <div className="controls">
      <div className="control-group">
        <div className="control-label">Show</div>
        <div className="seg">
          {(Object.keys(METRIC_LABEL) as Metric[]).filter((m) => available[m]).map((m) => (
            <button key={m} className={view.metric === m ? 'on' : ''} onClick={() => onChange({ ...view, metric: m })}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        {view.metric === 'net' && <div className="net-def">{netDefinition(net)}</div>}
      </div>

      {showNetBox && (
        <div className="control-group net-group">
          <div className="control-label">Net rent</div>
          {editable && (
            <label className="check" title="Off hides net rent everywhere">
              <input type="checkbox" checked={net.enabled} onChange={(e) => setNet({ enabled: e.target.checked })} />
              Show net rent
            </label>
          )}
          {net.enabled && (
            <>
              <div className="chips" role="group" aria-label="What counts toward net rent">
                {netParts.map((p) => (
                  <button
                    key={p.k}
                    className={net[p.k] ? 'chip on' : 'chip'}
                    aria-pressed={net[p.k]}
                    title={editable && !withData.has(p.k) ? 'No suite has an amount for this yet' : undefined}
                    onClick={() => setNet({ [p.k]: !net[p.k] } as Partial<NetSettings>)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {editable && net.incentives && (
                <label className="check term-field" title="Free rent is spread over the lease term. Used when the incentive text does not say the term.">
                  Free rent spread over
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={net.termMonths}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 1 && v <= 60) setNet({ termMonths: v });
                    }}
                  />
                  months unless the text says
                </label>
              )}
              {editable && (
                <label className="check" title="Clients can tick the same boxes to see their own version of net rent. Their choices are not saved.">
                  <input type="checkbox" checked={net.clientCanChange} onChange={(e) => setNet({ clientCanChange: e.target.checked })} />
                  Clients can change these
                </label>
              )}
            </>
          )}
        </div>
      )}

      <div className="control-group">
        <div className="control-label">Compare</div>
        <button
          className={view.summary.open ? 'chip on' : 'chip'}
          aria-pressed={view.summary.open}
          onClick={() => onChange({ ...view, summary: { ...view.summary, open: !view.summary.open } })}
        >
          Market summary
        </button>
      </div>

      {sections.map(({ k, label }) =>
        options[k].length > 0 ? (
          <div className="control-group" key={k}>
            <div className="control-label">{label}</div>
            <div className="chips">
              {options[k].map((v) => (
                <button key={v} className={view.filters[k].includes(v) ? 'chip on' : 'chip'} aria-pressed={view.filters[k].includes(v)} onClick={() => toggle(k, v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}

      {active && (
        <div className="control-group">
          <div className="control-label">
            Showing {shown} of {survey.buildings.length}
          </div>
          <button className="link-btn" onClick={() => onChange({ ...view, filters: NO_FILTERS })}>
            Clear filters
          </button>
        </div>
      )}

      {hasSubject && (
        <div className="control-group rings">
          <label className="check">
            <input type="checkbox" checked={view.rings} onChange={(e) => onChange({ ...view, rings: e.target.checked })} />
            Distance rings from subject
          </label>
          {editable && view.rings && (
            <div className="ring-list">
              {view.ringsKm.map((km, i) => (
                <RingInput
                  key={i}
                  km={km}
                  onCommit={(v) => onChange({ ...view, ringsKm: view.ringsKm.map((x, j) => (j === i ? v : x)) })}
                  onRemove={() => onChange({ ...view, ringsKm: view.ringsKm.filter((_, j) => j !== i) })}
                />
              ))}
              <button className="link-btn" onClick={() => onChange({ ...view, ringsKm: [...view.ringsKm, nextRing(view.ringsKm)] })}>
                + Add ring
              </button>
              <button className="link-btn" onClick={() => onChange({ ...view, ringsKm: DEFAULT_RINGS })}>
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
