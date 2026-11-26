import { useEffect, useMemo, useRef, useState } from 'react';
import type { Survey, ViewSettings, NetSettings } from '../types';
import { NET_PARTS, netOf, partsWithData } from '../lib/net';

export const DEFAULT_RINGS = [1, 3, 5];

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

/**
 * The editor's own strip: what counts toward net rent, and the distance of each ring. Everything a visitor can
 * choose (the rent type, the filters, the rings on or off) is in the summary panel's "Choose what to compare",
 * the same place the client sees it, so the editor previews exactly what a client will use.
 */
export default function Controls({ survey, view, onChange, editable, onNet }: Props) {
  const net = netOf(survey);
  const withData = useMemo(() => partsWithData(survey), [survey]);
  const setNet = (patch: Partial<NetSettings>) => onNet?.({ ...net, ...patch });
  const hasSubject = survey.buildings.some((b) => b.isSubject);
  const showRings = editable && hasSubject;
  if (!editable && !showRings) return null;

  return (
    <div className="controls">
      {editable && (
        <div className="control-group net-group">
          <div className="control-label">Net rent</div>
          <label className="check" title="Off hides net rent everywhere">
            <input type="checkbox" checked={net.enabled} onChange={(e) => setNet({ enabled: e.target.checked })} />
            Show net rent
          </label>
          {net.enabled && (
            <>
              <div className="chips" role="group" aria-label="What counts toward net rent">
                {NET_PARTS.map((p) => (
                  <button
                    key={p.k}
                    className="chip"
                    aria-pressed={net[p.k]}
                    title={!withData.has(p.k) ? 'No suite has an amount for this yet' : undefined}
                    onClick={() => setNet({ [p.k]: !net[p.k] } as Partial<NetSettings>)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {net.incentives && (
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
              <label className="check" title="Clients can tick the same boxes to see their own version of net rent. Their choices are not saved.">
                <input type="checkbox" checked={net.clientCanChange} onChange={(e) => setNet({ clientCanChange: e.target.checked })} />
                Clients can change these
              </label>
            </>
          )}
        </div>
      )}

      {showRings && (
        <div className="control-group rings">
          <div className="control-label" title="Clients are offered these distances, starting from the one chosen in the summary. They can also type their own.">Distances offered (km)</div>
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
        </div>
      )}
    </div>
  );
}
