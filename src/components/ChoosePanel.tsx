import { useEffect, useMemo, useState } from 'react';
import type { Metric, NetSettings, Survey, ViewSettings } from '../types';
import { METRIC_LABEL } from '../lib/format';
import { NET_PARTS, netOf, partsWithData } from '../lib/net';
import { filterOptions, type UnitFilters } from '../lib/groups';
import { FILTER_SECTIONS, activeChoices, availableMetrics, isDefaultChoice, matching, optionCount, resetChoice, viewSentence, withinCount } from '../lib/choose';
import { activeSubject, fmtKm } from '../lib/scope';

interface Props {
  /** Only buildings that are on the map. */
  survey: Survey;
  view: ViewSettings;
  onView: (v: ViewSettings) => void;
  /** The editor sets what counts toward net rent in its own strip; a client does it here, when allowed. */
  editable: boolean;
  onNet?: (n: NetSettings) => void;
  /** On a phone the full options live in the full-screen sheet; the small drawer shows only the sentence and a button to open it. */
  phone: boolean;
  expanded: boolean;
  onExpand: () => void;
}

/**
 * "Choose what to compare": the one place to change what the map, the chart and the table show. Every button that
 * can be pressed looks pressable (a visible border, a tint when pointed at, filled when chosen), each filter says
 * how many buildings are behind each button, and one sentence always says what is on screen.
 */
/** A distance of the visitor's own. Keeps its text so a half-typed "1." is allowed; commits a valid number. */
function OtherDistance({ within, offered, onPick }: { within: number | null; offered: number[]; onPick: (km: number) => void }) {
  const custom = within != null && !offered.includes(within);
  const [text, setText] = useState(custom ? String(within) : '');
  useEffect(() => {
    if (!custom) setText('');
  }, [custom]);
  const commit = (raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v <= 100) onPick(Math.round(v * 10) / 10);
  };
  return (
    <label className={`chip other-km${custom ? ' on' : ''}`} aria-pressed={custom}>
      Other
      <input
        type="number"
        inputMode="decimal"
        min={0.1}
        max={100}
        step={0.5}
        placeholder="km"
        aria-label="Another distance in km"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
      />
    </label>
  );
}

export default function ChoosePanel({ survey, view, onView, editable, onNet, phone, expanded, onExpand }: Props) {
  const [open, setOpen] = useState(true);
  const options = useMemo(() => filterOptions(survey), [survey]);
  const available = useMemo(() => availableMetrics(survey), [survey]);
  const withData = useMemo(() => partsWithData(survey), [survey]);
  const { shown, total } = useMemo(() => matching(survey, view.filters), [survey, view.filters]);
  const net = netOf(survey);
  const subjects = survey.buildings.filter((b) => b.isSubject && b.lngLat);
  const hasSubject = subjects.length > 0;
  const active = activeSubject(survey.buildings, view.subjectId);
  const offered = useMemo(() => [...new Set(view.ringsKm.filter((n) => n > 0))].sort((a, b) => a - b), [view.ringsKm]);
  const said = viewSentence(view, shown, total);
  const changed = !isDefaultChoice(view);

  const toggle = (k: keyof UnitFilters, v: string) => {
    const cur = view.filters[k];
    onView({ ...view, filters: { ...view.filters, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } });
  };
  const clear = (k: keyof UnitFilters) => onView({ ...view, filters: { ...view.filters, [k]: [] } });

  const sentence = (
    <div className="choose-sentence">
      <span>
        Showing <b>{said.rent}</b> for <b>{said.what}</b>{said.near ? <b>{said.near}</b> : null}, in <b>{said.where}</b>.
      </span>
      {changed && (
        <button className="link-btn" onClick={() => onView(resetChoice(view))}>
          Reset
        </button>
      )}
    </div>
  );

  // The small phone drawer: what is shown, and a button that opens the full-screen sheet with every option.
  if (phone && !expanded) {
    const n = activeChoices(view);
    return (
      <section className="choose strip" aria-label="Choose what to compare">
        {sentence}
        <button className="btn-change" onClick={onExpand}>
          Choose what to compare{n > 0 ? ` (${n})` : ''}
        </button>
      </section>
    );
  }

  // What counts toward net rent: the editor sets it in its own strip; a client may, when the editor allowed it.
  const netParts = NET_PARTS.filter((p) => withData.has(p.k));
  const showNetParts = !editable && net.enabled && net.clientCanChange && view.metric === 'net' && Boolean(onNet) && netParts.length > 0;

  return (
    <section className="choose" aria-label="Choose what to compare">
      <div className="choose-head">
        <h3>Choose what to compare</h3>
        <button className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide options' : 'Change options'}
        </button>
      </div>

      {open && (
        <>
          <div className="choose-group">
            <span className="choose-label">Rent type</span>
            <div className="seg wide" role="group" aria-label="Rent type">
              {(Object.keys(METRIC_LABEL) as Metric[])
                .filter((m) => available[m])
                .map((m) => (
                  <button key={m} aria-pressed={view.metric === m} onClick={() => onView({ ...view, metric: m })}>
                    {METRIC_LABEL[m]}
                  </button>
                ))}
            </div>
          </div>

          {showNetParts && (
            <div className="choose-group">
              <span className="choose-label">What counts toward net rent</span>
              <div className="chips" role="group" aria-label="What counts toward net rent">
                {netParts.map((p) => (
                  <button key={p.k} className="chip" aria-pressed={net[p.k]} onClick={() => onNet!({ ...net, [p.k]: !net[p.k] })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {FILTER_SECTIONS.filter(({ k }) => options[k].length > 0).map(({ k, label, all }) => (
            <div className="choose-group" key={k}>
              <span className="choose-label">{label}</span>
              <div className="chips" role="group" aria-label={label}>
                <button className="chip" aria-pressed={view.filters[k].length === 0} onClick={() => clear(k)}>
                  {all}
                </button>
                {options[k].map((v) => {
                  const n = optionCount(survey, view.filters, k, v);
                  return (
                    <button
                      key={v}
                      className="chip"
                      aria-pressed={view.filters[k].includes(v)}
                      title={n === 0 ? 'No comparable building has this with your other choices' : `${n} comparable building${n === 1 ? '' : 's'}`}
                      onClick={() => toggle(k, v)}
                    >
                      {v}
                      <small>{n}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {subjects.length > 1 && (
            <div className="choose-group">
              <span className="choose-label">Subject property</span>
              <div className="chips" role="group" aria-label="Subject property">
                {subjects.map((b) => (
                  <button key={b.id} className="chip" aria-pressed={active?.id === b.id} onClick={() => onView({ ...view, subjectId: b.id })}>
                    {b.name}
                  </button>
                ))}
              </div>
              <span className="choose-hint">The ring, the distances and the numbers on the pins are measured from this one. The others stay on the map, greyed, and are not counted.</span>
            </div>
          )}

          {hasSubject && (
            <div className="choose-group">
              <span className="choose-label">Distance from the subject</span>
              <div className="chips" role="group" aria-label="Distance from the subject">
                <button className="chip" aria-pressed={view.within == null} onClick={() => onView({ ...view, within: null })}>
                  Any distance
                </button>
                {offered.map((km) => {
                  const n = withinCount(survey, view.filters, km);
                  return (
                    <button
                      key={km}
                      className="chip"
                      aria-pressed={view.within === km}
                      title={`${n} comparable building${n === 1 ? '' : 's'} within ${fmtKm(km)}`}
                      onClick={() => onView({ ...view, within: km })}
                    >
                      Within {fmtKm(km)}
                      <small>{n}</small>
                    </button>
                  );
                })}
                <OtherDistance within={view.within ?? null} offered={offered} onPick={(km) => onView({ ...view, within: km })} />
              </div>
              {view.within == null && (
                <div className="chips">
                  <button className="chip" aria-pressed={view.rings} onClick={() => onView({ ...view, rings: !view.rings })}>
                    {view.rings ? 'Distance rings shown' : 'Show distance rings on the map'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {sentence}
    </section>
  );
}
