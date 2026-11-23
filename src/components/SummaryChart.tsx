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
  /** The small phone drawer: a shorter chart, so the whole of it shows without scrolling. */
  compact?: boolean;
}

const COMPACT_H = 168;

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

export default function SummaryChart({ result, metric, mode, dots, stat, compact = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(372);
  const [tip, setTip] = useState<{ row: number; x: number; y: number } | null>(null);
  // What the last press was made with. A mouse hovers (the tooltip follows it); a finger has no hover, so a
  // tap opens the tooltip, a second tap on the same bar closes it, and a tap anywhere else closes it too.
  const lastPointer = useRef('mouse');

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  // A tooltip left open must not outlive what it describes.
  useEffect(() => setTip(null), [result, mode, metric, dots, stat]);

  useEffect(() => {
    if (!tip) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.chart-plot')) setTip(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [tip]);

  const model = useMemo(() => layoutChart(result, mode, { metric, W: w, dots, H: compact ? COMPACT_H : undefined }), [result, mode, metric, w, dots, compact]);
  const notes = useMemo(() => chartNotes(result, mode), [result, mode]);
  const noSubject = mode === 'diff' && !result.hasSubject;
  const how = stat === 'median' ? 'median' : 'average';
  const anyBase = metric === 'net' && result.rows.some((r) => baseDiffers(r.marketBase, r.market.value) || baseDiffers(r.subjectBase, r.subject.value));

  if (result.rows.length === 0) return null;
  if (noSubject) return <p className="summary-note">Mark a subject property to see how it compares with the market.</p>;

  const show = (clientX: number, clientY: number, row: number) => {
    const b = wrap.current?.getBoundingClientRect();
    if (!b) return;
    setTip({ row, x: clientX - b.left, y: clientY - b.top });
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
      <div className="chart-plot" onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(null); }}>
        <svg
          viewBox={`0 0 ${model.width} ${model.height}`}
          width={model.width}
          height={model.height}
          role="img"
          aria-label={mode === 'diff' ? 'Subject difference from the market by unit type, in percent' : 'Subject and market figures by unit type'}
        >
          {model.shapes.map(draw)}
          {model.hits.map((h) => (
            <rect
              key={h.row}
              x={h.x}
              y={h.y}
              width={h.w}
              height={h.h}
              fill="transparent"
              onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
              onPointerMove={(e) => { if (e.pointerType === 'mouse') show(e.clientX, e.clientY, h.row); }}
              onClick={(e) => {
                if (lastPointer.current === 'mouse') return; // hover already shows it
                if (tip?.row === h.row) setTip(null);
                else show(e.clientX, e.clientY, h.row);
              }}
            />
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
