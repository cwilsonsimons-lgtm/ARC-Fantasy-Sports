import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../core/history';
import { fmt, shortDate } from './common';

export interface Series {
  key: string;
  label: string;
  color: string;
  points: Point[];
}

const H = 230;
const PAD = { l: 46, r: 92, t: 12, b: 26 };

function niceTicks(lo: number, hi: number, n = 4) {
  const span = Math.max(1, hi - lo);
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let x = start; x <= hi + step * 0.001; x += step) out.push(Math.round(x));
  return out;
}

const t = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).getTime();

export function LineChart({ series }: { series: Series[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const live = series.filter((s) => s.points.length);
  const dates = useMemo(() => [...new Set(live.flatMap((s) => s.points.map((p) => p.date)))].sort(), [live]);
  if (!live.length) return null;
  const all = live.flatMap((s) => s.points.map((p) => p.value));
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  const padV = Math.max(200, (hi0 - lo0) * 0.12);
  const ticks = niceTicks(Math.max(0, lo0 - padV), hi0 + padV);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const narrow = w < 420;
  const pr = narrow ? 12 : PAD.r;
  const t0 = t(dates[0]);
  const t1 = t(dates[dates.length - 1]);
  const x = (d: string) => (t1 === t0 ? (PAD.l + w - pr) / 2 : PAD.l + ((t(d) - t0) / (t1 - t0)) * (w - pr - PAD.l));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const xTicks = dates.length <= 5 ? dates : [0, 0.33, 0.66, 1].map((f) => dates[Math.round(f * (dates.length - 1))]);

  // End labels, nudged apart so they never collide.
  const ends = live
    .map((s) => ({ s, p: s.points[s.points.length - 1] }))
    .map((e) => ({ ...e, y: y(e.p.value) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    let best = 0;
    let bd = Infinity;
    dates.forEach((d, i) => {
      const dd = Math.abs(x(d) - px);
      if (dd < bd) (bd = dd), (best = i);
    });
    setHover(best);
  };
  const hd = hover != null ? dates[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="false">
        {live.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={'Value over time: ' + live.map((s) => s.label).join(', ')} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">
          {ticks.map((v) => (
            <line key={v} x1={PAD.l} x2={w - pr} y1={y(v)} y2={y(v)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((v) => (
            <text key={v} x={PAD.l - 8} y={y(v) + 4} textAnchor="end">
              {fmt(v)}
            </text>
          ))}
          {xTicks.map((d, i) => (
            <text key={d + i} x={x(d)} y={H - 6} textAnchor={xTicks.length > 1 && i === 0 ? 'start' : i === xTicks.length - 1 && xTicks.length > 1 ? 'end' : 'middle'}>
              {shortDate(d)}
            </text>
          ))}
        </g>
        {hd && <line x1={x(hd)} x2={x(hd)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />}
        {live.map((s) => {
          const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
          const rebuilt = s.points.some((p) => p.rebuilt);
          return (
            <g key={s.key}>
              {s.points.length > 1 && <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={rebuilt ? '5 4' : undefined} />}
              {s.points.map((p, i) =>
                p.rebuilt && s.points.length > 1 ? null : (
                  <circle key={i} cx={x(p.date)} cy={y(p.value)} r={s.points.length === 1 ? 5 : 3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ),
              )}
            </g>
          );
        })}
        {!narrow &&
          ends.map((e) => (
            <text key={e.s.key} className="dlabel" x={x(e.p.date) + 8} y={e.y + 4}>
              {e.s.label.length > 12 ? e.s.label.slice(0, 11) + '…' : e.s.label}
            </text>
          ))}
        <rect x={PAD.l} y={PAD.t} width={Math.max(0, w - pr - PAD.l)} height={H - PAD.t - PAD.b} fill="transparent" />
      </svg>
      {hd && (
        <div className="tip" style={{ left: Math.min(Math.max(0, x(hd) - 80), w - 170), top: 30 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{shortDate(hd)}</div>
          {live.map((s) => {
            const p = s.points.find((q) => q.date === hd);
            return p ? (
              <div className="kv" key={s.key}>
                <span>
                  <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />
                  {s.label}
                </span>
                <span className="num">{fmt(p.value)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
