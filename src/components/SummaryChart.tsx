import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartMode, Metric, Stat } from '../types';
import { formatMetric } from '../lib/format';
import type { SummaryResult, SummaryRow } from '../lib/summary';
import { fmtDiff } from '../lib/summaryFormat';
import { CHART_COLORS as C, baseDiffers, chartNotes, layoutChart, type Shape } from '../lib/chartLayout';

interface Props {
  result: SummaryResult;
  metric: Metric;
  mode: Exclude<ChartMode, 'off'>;
  dots: boolean;
  stat: Stat;
}

function draw(s: Shape, i: number) {
  switch (s.k) {
    case 'path':
      return <path key={i} d={s.d} fill={s.fill} />;
    case 'line':
      return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.w} />;
    case 'dot':
      return <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.fill} stroke={s.ring} strokeWidth={2} />;
    case 'text':
      return (
        <text
          key={i}
          x={s.rotate ? 0 : s.x}
          y={s.rotate ? 0 : s.y}
          transform={s.rotate ? `translate(${s.x},${s.y}) rotate(${s.rotate})` : undefined}
          textAnchor={s.anchor}
          fontSize={s.size}
          fontWeight={s.bold ? 600 : 400}
          fill={s.color}
        >
          {s.s}
        </text>
      );
  }
}

export default function SummaryChart({ result, metric, mode, dots, stat }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(372);
  const [tip, setTip] = useState<{ row: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => layoutChart(result, mode, { metric, W: w, dots }), [result, mode, metric, w, dots]);
  const notes = useMemo(() => chartNotes(result, mode), [result, mode]);
  const noSubject = mode === 'diff' && !result.hasSubject;
  const how = stat === 'median' ? 'median' : 'average';
  const anyBase = metric === 'net' && result.rows.some((r) => baseDiffers(r.marketBase, r.market.value) || baseDiffers(r.subjectBase, r.subject.value));

  if (result.rows.length === 0) return null;
  if (noSubject) return <p className="summary-note">Mark a subject property to see how it compares with the market.</p>;

  const onHover = (e: React.MouseEvent, row: number) => {
    const b = wrap.current?.getBoundingClientRect();
    if (!b) return;
    setTip({ row, x: e.clientX - b.left, y: e.clientY - b.top });
  };
  const r = tip ? result.rows[tip.row] : null;

  return (
    <div className="summary-chart" ref={wrap}>
      <div className="chart-legend">
        {mode === 'compare' ? (
          <>
            <span><i className="sw" style={{ background: C.market }} />Market ({how} of comps)</span>
            {result.hasSubject && <span><i className="sw" style={{ background: C.subject }} />Subject</span>}
            {dots && <span><i className="dotkey" />Each comp building</span>}
            {anyBase && <span><i className="tickkey" />Base rent before extras and incentives</span>}
          </>
        ) : (
          <>
            <span><i className="sw" style={{ background: C.below }} />Subject below market</span>
            <span><i className="sw" style={{ background: C.above }} />Subject above market</span>
          </>
        )}
      </div>
      <div className="chart-plot" onMouseLeave={() => setTip(null)}>
        <svg
          viewBox={`0 0 ${model.width} ${model.height}`}
          width={model.width}
          height={model.height}
          role="img"
          aria-label={mode === 'diff' ? 'Subject difference from the market by unit type, in percent' : 'Subject and market figures by unit type'}
        >
          {model.shapes.map(draw)}
          {model.hits.map((h) => (
            <rect key={h.row} x={h.x} y={h.y} width={h.w} height={h.h} fill="transparent" onMouseMove={(e) => onHover(e, h.row)} onClick={(e) => onHover(e, h.row)} />
          ))}
        </svg>
        {tip && r && <Tip row={r} metric={metric} stat={stat} hasSubject={result.hasSubject} x={tip.x} y={tip.y} box={wrap.current?.clientWidth ?? w} />}
      </div>
      {notes.length > 0 && (
        <ul className="chart-notes">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

function Tip({ row, metric, stat, hasSubject, x, y, box }: { row: SummaryRow; metric: Metric; stat: Stat; hasSubject: boolean; x: number; y: number; box: number }) {
  const net = metric === 'net';
  const left = x + 190 > box ? Math.max(0, x - 200) : x + 12;
  return (
    <div className="chart-tip" style={{ left, top: y + 12 }}>
      <b>{row.label}</b>
      {row.market.value != null ? (
        <>
          <div className="tip-row"><span>Market {stat === 'median' ? 'median' : 'average'}</span><b>{formatMetric(row.market.value, metric)}</b></div>
          {net && baseDiffers(row.marketBase, row.market.value) && <div className="tip-row"><span>Base rent before extras</span><span>{formatMetric(row.marketBase, metric)}</span></div>}
          {[...row.comps].sort((a, b) => b.value - a.value).map((c) => (
            <div className="tip-row sub" key={c.id}><span>{c.name}</span><span>{formatMetric(c.value, metric)}</span></div>
          ))}
        </>
      ) : (
        <div className="tip-row"><span>Market</span><span>no comparable</span></div>
      )}
      {hasSubject && (
        <>
          <hr />
          {row.subject.value != null ? (
            <>
              <div className="tip-row"><span>Subject</span><b>{formatMetric(row.subject.value, metric)}</b></div>
              {net && baseDiffers(row.subjectBase, row.subject.value) && <div className="tip-row"><span>Base rent before extras</span><span>{formatMetric(row.subjectBase, metric)}</span></div>}
            </>
          ) : (
            <div className="tip-row"><span>Subject</span><span>no units</span></div>
          )}
          {row.diff != null && <div className="tip-row"><span>Difference</span><b>{fmtDiff(row, metric)}</b></div>}
        </>
      )}
    </div>
  );
}
