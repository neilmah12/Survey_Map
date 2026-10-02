import { useEffect, useMemo, useRef, useState } from 'react';
import type { Survey, ViewSettings, Metric } from '../types';
import { METRIC_LABEL } from '../lib/format';
import { availableDims, listGroups } from '../lib/groups';

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
}

export default function Controls({ survey, view, onChange, editable }: Props) {
  const groups = useMemo(() => listGroups(survey, view.dims), [survey, view.dims]);
  const dimsAvailable = useMemo(() => availableDims(survey), [survey]);
  const hasSubject = survey.buildings.some((b) => b.isSubject);
  const toggleGroup = (g: string) =>
    onChange({ ...view, groups: view.groups.includes(g) ? view.groups.filter((x) => x !== g) : [...view.groups, g] });
  // Changing the split changes what the group labels are, so the selection starts over.
  const setDim = (k: keyof ViewSettings['dims'], on: boolean) => onChange({ ...view, dims: { ...view.dims, [k]: on }, groups: [] });
  const splitOptions: { k: keyof ViewSettings['dims']; label: string }[] = [
    { k: 'baths', label: 'Bathrooms' },
    { k: 'reno', label: 'Renovation' },
    { k: 'kind', label: 'Townhome / apartment' },
  ];
  const offered = splitOptions.filter((o) => dimsAvailable[o.k] || view.dims[o.k]);

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

      {groups.length > 1 && (
        <div className="control-group">
          <div className="control-label">Unit type</div>
          <div className="chips">
            <button className={view.groups.length === 0 ? 'chip on' : 'chip'} onClick={() => onChange({ ...view, groups: [] })}>
              All
            </button>
            {groups.map((g) => (
              <button key={g} className={view.groups.includes(g) ? 'chip on' : 'chip'} onClick={() => toggleGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        </div>
      )}

      {offered.length > 0 && (
        <div className="control-group">
          <div className="control-label">Split by</div>
          <div className="splits">
            {offered.map((o) => (
              <label key={o.k} className="check">
                <input type="checkbox" checked={view.dims[o.k]} onChange={(e) => setDim(o.k, e.target.checked)} />
                {o.label}
              </label>
            ))}
          </div>
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
