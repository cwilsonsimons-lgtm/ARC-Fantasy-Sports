// Arc Markets — the live price chart.
//
// Replaces the seeded season-only chart with one that reads the tape, across
// the ranges a trading screen is expected to have: 1D / 1W / 1M / Season /
// Contract lifetime / All time.
//
// EVENT SCALING. The same event feed drives every range, filtered by tier, so a
// one-day chart can show touchdowns while an all-time chart shows only the
// handful of things that mattered to a career. Markers are also capped per
// range and de-duplicated by proximity, so a busy week cannot turn the line
// into a wall of pins.
import { esc, money } from './ui.js';
import { RANGES, seriesFor } from './quotes.js';
import { KINDS, eventsFor, tierForRange } from './events.js';
import { symbolFor, contractSeasons, TERM_BY_KEY, DEFAULT_TERM } from './contracts.js';

const UP = '#2BE06B', DOWN = '#FF4B4B';
const W = 320, H = 118;
const MAX_MARKS = { '1d': 8, '1w': 8, '1m': 7, season: 6, contract: 6, all: 5 };

/** Events for this range: right tier, right window, thinned to fit. */
export function marksFor(playerId, range, t0, t1) {
  const evs = eventsFor(playerId, { maxTier: tierForRange(range), since: t0 })
    .filter(e => e.ts <= t1);
  const cap = MAX_MARKS[range] || 6;
  if (evs.length <= cap) return evs;
  // keep the biggest movers, then restore chronological order
  return evs
    .slice()
    .sort((a, b) => (a.tier - b.tier) || (Math.abs(b.sentiment) - Math.abs(a.sentiment)))
    .slice(0, cap)
    .sort((a, b) => a.ts - b.ts);
}

export function priceChart(p, range, term) {
  const key = TERM_BY_KEY[term] ? term : DEFAULT_TERM;
  const sym = symbolFor(p.id, key);
  const pts = seriesFor(sym, range, { openedAt: contractOpened(key) });
  if (pts.length < 2) return `<div class="mkc" data-mkc="price"><div class="mkc-t">PRICE</div>
    <div class="mkc-none">Not enough trades yet on this contract.</div></div>`;

  const vs = pts.map(q => q.v);
  const first = vs[0], last = vs[vs.length - 1];
  const min = Math.min(...vs), max = Math.max(...vs);
  const up = last >= first;
  const color = up ? UP : DOWN;
  const pad = (max - min) * 0.18 || 0.05;
  const lo = min - pad, hi = max + pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
  const X = t => ((t - t0) / span) * W;
  const Y = v => H - ((v - lo) / (hi - lo)) * H;
  const line = pts.map(q => `${X(q.t).toFixed(1)},${Y(q.v).toFixed(1)}`).join(' ');

  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  const label = (RANGES.find(r => r[0] === range) || RANGES[0])[2];

  // markers, placed on the line at the moment they happened
  const marks = marksFor(p.id, range, t0, t1);
  const valueAt = ts => {
    let best = pts[0];
    for (const q of pts) { if (q.t <= ts) best = q; else break; }
    return best.v;
  };
  const pins = marks.map((e, i) => {
    const k = KINDS[e.kind] || {};
    const x = Math.max(2, Math.min(W - 2, X(e.ts)));
    const y = Y(valueAt(e.ts));
    return `<g class="mkc-ev" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <line x1="0" y1="0" x2="0" y2="${(H - y - 4).toFixed(1)}" />
      <circle r="3" class="ev-${k.tone || 'flat'}" />
    </g>`;
  }).join('');
  const legend = marks.length ? `<div class="mkc-evs">${marks.map(e => {
    const k = KINDS[e.kind] || {};
    return `<span class="mkc-evl ev-${k.tone || 'flat'}" title="${esc(e.text)}">${k.icon || '•'} ${esc(shortText(e.text))}</span>`;
  }).join('')}</div>` : '';

  return `
    <div class="mkc" data-mkc="price">
      <div class="mkc-h">
        <div class="mkc-t">PRICE</div>
        <div class="mkc-d ${up ? 'up' : 'down'}">${delta < 0 ? '-' : '+'}${money(delta)}
          (${pct < 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%) &middot; ${esc(label.toLowerCase())}</div>
      </div>
      <div class="mkc-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="mkc-svg">
          <defs><linearGradient id="mkcpx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity=".34"/>
            <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
          <line class="mkc-base" x1="0" y1="${Y(first).toFixed(1)}" x2="${W}" y2="${Y(first).toFixed(1)}"/>
          <polygon points="0,${H} ${line} ${W},${H}" fill="url(#mkcpx)"/>
          <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
          ${pins}
          <circle class="mkc-dot" cx="${W}" cy="${Y(last).toFixed(1)}" r="3.4" fill="${color}"/>
        </svg>
        <div class="mkc-hi">${money(max)}</div>
        <div class="mkc-lo">${money(min)}</div>
      </div>
      <div class="mkc-read"><span class="a">${money(last)}</span><span class="b">Live</span></div>
      <div class="mkc-ranges">${RANGES.map(([k, lb]) =>
        `<div class="mkc-rg${k === range ? ' on' : ''}" onclick="mkRange('${p.id}','${k}')">${lb}</div>`
      ).join('')}</div>
      ${legend}
    </div>`;
}

function shortText(s) { return String(s).length > 26 ? String(s).slice(0, 25) + '…' : s; }
function contractOpened(term) {
  const seasons = contractSeasons(term);
  // treat the contract as having listed at the start of its first season
  return Date.now() - (seasons.length * 240 + 60) * 86400000;
}
