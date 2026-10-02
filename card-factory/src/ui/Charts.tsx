import React, { useRef, useState } from 'react';

export interface Pt {
  x: number;
  y: number | null;
}

interface LineProps {
  points: Pt[];
  dots?: Pt[];
  height?: number;
  fmtY: (n: number) => string;
  fmtX: (n: number) => string;
  /** Axis labels; defaults to fmtY. */
  fmtTick?: (n: number) => string;
  label: string;
  zeroBased?: boolean;
}

function niceTicks(lo: number, hi: number, n = 4) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Single-series line with an area fill, optional sale dots, and a hover crosshair. */
export function LineChart({ points, dots = [], height = 200, fmtY, fmtX, fmtTick, label, zeroBased }: LineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const m = { l: 56, r: 14, t: 12, b: 26 };
  const xs = [...points.map((p) => p.x), ...dots.map((p) => p.x)];
  const ys = [...points, ...dots].map((p) => p.y).filter((y): y is number => y !== null);
  if (!xs.length || !ys.length) return <div className="chart-empty">{label}: not enough history yet.</div>;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const ticks = niceTicks(zeroBased ? Math.min(0, ...ys) : Math.min(...ys) * 0.9, Math.max(...ys) * 1.05);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const segs: string[] = [];
  let cur = '';
  for (const p of points) {
    if (p.y === null) {
      if (cur) segs.push(cur);
      cur = '';
      continue;
    }
    cur += `${cur ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
  }
  if (cur) segs.push(cur);
  const valid = points.filter((p) => p.y !== null) as { x: number; y: number }[];
  const area = valid.length > 1 ? `M${sx(valid[0].x)},${sy(y0)} ${valid.map((p) => `L${sx(p.x)},${sy(p.y)}`).join(' ')} L${sx(valid[valid.length - 1].x)},${sy(y0)} Z` : '';
  const xTicks = niceTicks(x0, x1, 5).filter((t) => t >= x0 && t <= x1 && Number.isInteger(t));
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best: number | null = null;
    let bd = Infinity;
    valid.forEach((p, i) => {
      const d = Math.abs(sx(p.x) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };
  const hp = hover !== null ? valid[hover] : null;
  const last = valid[valid.length - 1];
  return (
    <figure className="chart" aria-label={label}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" className="chart-tick">{(fmtTick ?? fmtY)(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - 6} textAnchor="middle" className="chart-tick">{fmtX(t)}</text>
        ))}
        {area && <path d={area} className="chart-area" />}
        {segs.map((d, i) => <path key={i} d={d} className="chart-line" />)}
        {dots.filter((d) => d.y !== null).map((d, i) => <circle key={i} cx={sx(d.x)} cy={sy(d.y!)} r="3.2" className="chart-dot" />)}
        {last && <circle cx={sx(last.x)} cy={sy(last.y)} r="4.5" className="chart-end" />}
        {hp && (
          <g>
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={m.t} y2={H - m.b} className="chart-cross" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r="5" className="chart-end" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${(sx(hp.x) / W) * 100}%` }}>
          <strong>{fmtY(hp.y)}</strong> <span>{fmtX(hp.x)}</span>
        </div>
      )}
    </figure>
  );
}

/** Signed bars (profit / loss per week) with hover readout. */
export function BarChart({ data, fmtY, fmtX, label, height = 180 }: { data: { x: number; y: number }[]; fmtY: (n: number) => string; fmtX: (n: number) => string; label: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="chart-empty">{label}: no weeks played yet.</div>;
  const W = 640;
  const H = height;
  const m = { l: 56, r: 10, t: 12, b: 24 };
  const ticks = niceTicks(Math.min(0, ...data.map((d) => d.y)), Math.max(0, ...data.map((d) => d.y)));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const sy = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / data.length;
  const every = Math.ceil(data.length / 8);
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerLeave={() => setHover(null)} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className={t === 0 ? 'chart-zero' : 'chart-grid'} />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" className="chart-tick">{fmtY(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = m.l + i * bw;
          const top = sy(Math.max(0, d.y));
          const h = Math.max(1, Math.abs(sy(d.y) - sy(0)));
          return (
            <g key={d.x} onPointerEnter={() => setHover(i)}>
              <rect x={x} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" />
              <rect x={x + Math.min(2, bw * 0.15)} y={top} width={Math.max(1, bw - Math.min(4, bw * 0.3))} height={h} rx={Math.min(3, bw / 4)} className={d.y >= 0 ? 'bar-pos' : 'bar-neg'} opacity={hover === null || hover === i ? 1 : 0.55} />
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="chart-tick">{fmtX(d.x)}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((m.l + (hover + 0.5) * bw) / W) * 100}%` }}>
          <strong>{fmtY(data[hover].y)}</strong> <span>{fmtX(data[hover].x)}</span>
        </div>
      )}
    </figure>
  );
}

export function Sparkline({ values, width = 80, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="spark-empty">—</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)).toFixed(1)}`);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts.join(' ')} />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r="2.2" />
    </svg>
  );
}
