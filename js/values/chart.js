// Small inline-SVG charts: a sparkline for table rows and a two-line history
// chart (Dynasty Daddy dashed, league value solid) with trade markers.

const W = 520, H = 200, PAD = { l: 44, r: 10, t: 10, b: 22 };

export function sparkline(points, w = 80, h = 22) {
  if (new Set(points.map(p => p.date)).size < 2) return '';
  const ys = points.map(p => p.league);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const d = points.map((p, i) =>
    `${i ? 'L' : 'M'}${(i / (points.length - 1) * w).toFixed(1)},${(h - 2 - (p.league - lo) / span * (h - 4)).toFixed(1)}`).join('');
  const cls = ys[ys.length - 1] >= ys[0] ? 'up' : 'down';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="${cls}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

export function historyChart(points, markers = []) {
  if (new Set(points.map(p => p.date)).size < 2) return '<p class="lv-note">Not enough history to chart yet. Load the Dynasty Daddy 3-month history on Setup, or keep loading values every few days.</p>';
  const t0 = points[0].date, t1 = points[points.length - 1].date || t0 + 1;
  const vals = points.flatMap(p => [p.dd, p.league]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
  lo = Math.max(0, lo - pad); hi += pad;
  const x = t => PAD.l + (t - t0) / ((t1 - t0) || 1) * (W - PAD.l - PAD.r);
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  const ticks = [0, 0.5, 1].map(f => lo + f * (hi - lo));
  const grid = ticks.map(v => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="ax" x="${PAD.l - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`).join('');
  const fmt = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  const xlab = `<text class="ax" x="${PAD.l}" y="${H - 6}">${fmt(t0)}</text><text class="ax" x="${W - PAD.r}" y="${H - 6}" text-anchor="end">${fmt(t1)}</text>`;

  const at = t => {
    let best = points[0];
    for (const p of points) { if (p.date <= t) best = p; else break; }
    return best;
  };
  const mk = markers.filter(m => m.date >= t0 && m.date <= t1).map(m =>
    `<circle class="mk ${m.kind}" cx="${x(m.date)}" cy="${y(at(m.date).league)}" r="4"><title>${m.title}</title></circle>`).join('');

  return `<svg class="lv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Value history">
    ${grid}${xlab}<path class="dd" d="${path('dd')}"/><path class="lg" d="${path('league')}"/>${mk}</svg>
    <div class="lv-legend"><span><i></i>League value</span><span><i class="dd"></i>Dynasty Daddy</span><span>○ trade · <span class="down">○</span> rejected offer</span></div>`;
}
