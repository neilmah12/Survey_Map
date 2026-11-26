import { useMemo, useState } from 'react';
import type { Metric, NetSettings, Survey, ViewSettings } from '../types';
import { METRIC_LABEL } from '../lib/format';
import { NET_PARTS, netOf, partsWithData } from '../lib/net';
import { filterOptions, type UnitFilters } from '../lib/groups';
import { FILTER_SECTIONS, activeChoices, availableMetrics, isDefaultChoice, matching, optionCount, resetChoice, viewSentence } from '../lib/choose';

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
export default function ChoosePanel({ survey, view, onView, editable, onNet, phone, expanded, onExpand }: Props) {
  const [open, setOpen] = useState(true);
  const options = useMemo(() => filterOptions(survey), [survey]);
  const available = useMemo(() => availableMetrics(survey), [survey]);
  const withData = useMemo(() => partsWithData(survey), [survey]);
  const { shown, total } = useMemo(() => matching(survey, view.filters), [survey, view.filters]);
  const net = netOf(survey);
  const hasSubject = survey.buildings.some((b) => b.isSubject);
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
        Showing <b>{said.rent}</b> for <b>{said.what}</b> in <b>{said.where}</b>.
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

          {hasSubject && (
            <div className="choose-group">
              <span className="choose-label">Distance from the subject</span>
              <div className="chips">
                <button className="chip" aria-pressed={view.rings} onClick={() => onView({ ...view, rings: !view.rings })}>
                  {view.rings ? 'Distance rings shown' : 'Show distance rings on the map'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {sentence}
    </section>
  );
}
