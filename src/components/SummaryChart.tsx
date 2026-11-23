import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
        {tip && r && <Tip row={r} metric={metric} stat={stat} hasSubject={result.hasSubject} x={tip.x} y={tip.y} box={wrap.current?.clientWidth ?? w} plotH={model.height} />}
      </div>
      {notes.length > 0 && (
        <ul className="chart-notes">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

const suites = (n: number) => `${n} suite${n === 1 ? '' : 's'}`;

function Tip({ row, metric, stat, hasSubject, x, y, box, plotH }: { row: SummaryRow; metric: Metric; stat: Stat; hasSubject: boolean; x: number; y: number; box: number; plotH: number }) {
  const net = metric === 'net';
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  // The bubble is as wide as its longest line, so it is measured, then kept on screen: beside the pointer,
  // flipped to the other side at an edge, and above the pointer when there is no room below.
  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    let left = x + 14;
    if (left + tw > box) left = x - tw - 14;
    left = Math.max(0, Math.min(left, box - tw));
    let top = y + 14;
    if (top + th > plotH + 24) top = Math.max(0, y - th - 14);
    setPos({ left, top });
  }, [x, y, box, plotH, row, metric, stat]);
  const baseM = net && baseDiffers(row.marketBase, row.market.value);
  const baseS = net && baseDiffers(row.subjectBase, row.subject.value);
  return (
    <div className="chart-tip" ref={el} style={pos}>
      <div className="tip-title">{row.label}</div>
      <div className="tip-grid">
        {row.market.value != null ? (
          <>
            <span className="name strong">Market {stat === 'median' ? 'median' : 'average'}</span>
            <b className="val">{formatMetric(row.market.value, metric)}</b>
            {baseM && (
              <>
                <span className="name sub">Base rent before incentives</span>
                <span className="val sub">{formatMetric(row.marketBase!, metric)}</span>
              </>
            )}
            <span className="tip-section">Comparable buildings</span>
            {[...row.comps].sort((a, b) => b.value - a.value).map((c) => (
              <Fragment key={c.id}>
                <span className="name">
                  <span className="nm">{c.name}</span>
                  {c.units > 1 && <em>· {suites(c.units)}</em>}
                </span>
                <span className="val">{formatMetric(c.value, metric)}</span>
              </Fragment>
            ))}
          </>
        ) : (
          <>
            <span className="name strong">Market</span>
            <span className="val">no comparable</span>
          </>
        )}
        {hasSubject && (
          <>
            <span className="tip-rule" />
            {row.subject.value != null ? (
              <>
                <span className="name strong">Subject</span>
                <b className="val">{formatMetric(row.subject.value, metric)}</b>
                {baseS && (
                  <>
                    <span className="name sub">Base rent before incentives</span>
                    <span className="val sub">{formatMetric(row.subjectBase!, metric)}</span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="name strong">Subject</span>
                <span className="val">no units</span>
              </>
            )}
            {row.diff != null && (
              <>
                <span className="name">Difference</span>
                <b className="val">{fmtDiff(row, metric)}</b>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
