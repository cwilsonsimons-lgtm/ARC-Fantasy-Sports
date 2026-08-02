// Arc Markets — shared rendering helpers (icons, sparklines, rows, formatting).
import { isWatched, gameLog, paceData, SEASON_GAMES, WEEKS_PLAYED } from './data.js';

// No currency marks anywhere in this section: a price is a quantity of points
// over POINTS_PER_DOLLAR, and it reads as a bare number. `money` keeps its name
// because every call site means "format this as a price".
export const money = n => Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const signed = n => (n < 0 ? '-' : '+') + money(n);
export const pctText = n => n.toFixed(1) + '%';
export const dirClass = n => (n < 0 ? 'down' : 'up');
// A short position is one signed integer, shown with its minus and its colour.
// There is no separate short ledger for it to live in.
export const qtyText = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString();
export const qtyClass = n => (n < 0 ? 'down' : n > 0 ? 'up' : '');

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICON = {
  burger:  svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  search:  svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  bell:    svg('<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  flame:   svg('<path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.8-3 1.6-4"/>'),
  drop:    svg('<path d="M4 7 10 13l4-4 6 6"/><path d="M20 15v-4h-4"/>'),
  rocket:  svg('<path d="M5 15c-1 2-1 5-1 5s3 0 5-1"/><path d="M9 13a12 12 0 0 1 9-9 12 12 0 0 1-9 9Z"/><path d="m9 13 2 2"/>'),
  star:    svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  trend:   svg('<path d="M3 17 9 11l4 4 8-8"/><path d="M17 7h4v4"/>'),
  movers:  svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20v-3"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  sort:    svg('<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>'),
  market:  svg('<path d="M4 18 9 11l4 4 7-9"/><path d="M15 6h5v5"/>'),
  bag:     svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  trophy:  svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/><path d="M9 20h6M12 14v6"/>'),
  person:  svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  news:    svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h7M7 12h10M7 16h6"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>'),
  info:    svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h0"/>'),
  bars:    svg('<path d="M5 20V12M12 20V6M19 20v-5"/>'),
};

// A sparkline from 0..1 values. `fill` shades the area beneath the line.
export function spark(values, color, { w = 58, h = 26, fill = false, id = '' } = {}) {
  if (!values || !values.length) return '';
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - v * (h - 4)).toFixed(1)}`);
  const line = `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}"
    stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (!fill) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${line}</svg>`;
  const gid = 'mkg' + id;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".45"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="url(#${gid})"/>${line}
    <circle cx="${w}" cy="${(h - 2 - values[values.length - 1] * (h - 4)).toFixed(1)}" r="2.6" fill="${color}"/>
  </svg>`;
}

export function face(p) {
  const initials = (p.name || '').split(' ').map(s => s[0]).slice(0, 2).join('');
  // headshots are remote; if one fails, drop the <img> so the initials show through
  return `<div class="face">${esc(initials)}${p.hs
    ? `<img src="${esc(p.hs)}" alt="" loading="lazy"
         style="position:absolute" onerror="this.remove()">`
    : ''}</div>`;
}

export const tri = n => `<span class="mk-tri ${n < 0 ? 'd' : 'u'}"></span>`;

// A sparkline draws the whole season, so it is coloured by the season - the
// same rule the price chart uses. The percentage beside it is today's move and
// keeps its own colour; a green day inside a red year is worth seeing.
const UP = '#2BE06B', DOWN = '#FF4B4B', GREY = '#5A6675';
export const sparkColor = p => (p.seasonUp === false ? DOWN : UP);

// ---------------------------------------------------------------- thumbnails
// The trend column on the Market screen can draw any of the three charts a
// contract opens with, so a scan of the list can be about price, about output,
// or about whether the price is being earned - without opening anything.
export const THUMBS = [
  ['price', 'Price',  'Season price line'],
  ['five',  'Last 5', 'Points per game against his average'],
  ['pace',  'Pace',   'Banked points against the price'],
];

/** Chart B in 46x26: five bars, the average as a dashed rule. */
function thumbFive(p, w, h) {
  const played = gameLog(p).slice(0, WEEKS_PLAYED);
  if (!played.length) return '';
  const five = played.slice(-5);
  const avg = played.reduce((n, g) => n + g.pts, 0) / played.length;
  const top = Math.max(avg, ...five.map(g => g.pts)) * 1.08 || 1;
  const bw = w / five.length;
  const ay = (h - (avg / top) * (h - 2)).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${five.map((g, i) => {
      const bh = Math.max(1.5, (g.pts / top) * (h - 2));
      return `<rect x="${(i * bw + 0.8).toFixed(1)}" y="${(h - bh).toFixed(1)}"
        width="${(bw - 1.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"
        fill="${g.pts >= avg ? UP : DOWN}" opacity=".92"/>`;
    }).join('')}
    <line x1="0" y1="${ay}" x2="${w}" y2="${ay}" stroke="${GREY}" stroke-width="1"
      stroke-dasharray="2 2"/></svg>`;
}

/** Chart C in 46x26: banked points, the price pace as a dashed rule, gap shaded. */
function thumbPace(p, w, h) {
  const d = paceData(p);
  if (d.cum.length < 2) return '';
  const color = d.ahead >= 0 ? UP : DOWN;
  const top = Math.max(d.target, d.run) * 1.05 || 1;
  const X = wk => ((wk / SEASON_GAMES) * w).toFixed(1);
  const Y = v => (h - (v / top) * (h - 2)).toFixed(1);
  const line = d.cum.map(c => `${X(c.week)},${Y(c.pts)}`).join(' ');
  const last = d.cum[d.cum.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="${X(0)},${Y(0)} ${line} ${X(last.week)},${Y(d.paceNow)}"
      fill="${color}" opacity=".28"/>
    <line x1="0" y1="${Y(0)}" x2="${X(SEASON_GAMES)}" y2="${Y(d.target)}" stroke="${GREY}"
      stroke-width="1" stroke-dasharray="2 2"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function thumb(p, mode, w = 46, h = 26) {
  if (mode === 'five') return thumbFive(p, w, h);
  if (mode === 'pace') return thumbPace(p, w, h);
  return spark(p.spark, sparkColor(p), { w, h });
}

export function starCell(p) {
  return `<div class="star${isWatched(p.id) ? ' on' : ''}" data-star="${p.id}"
    onclick="event.stopPropagation();mkToggleWatch('${p.id}',this)">${ICON.star}</div>`;
}

/** A row on the Market screen: price, 24h change, trend, watch star. */
export function marketRow(p, mode) {
  const d = dirClass(p.pct);
  return `<div class="mk-row" onclick="mkOpenPlayer('${p.id}')">
    <div class="bar" style="background:${p.color}"></div>
    ${face(p)}
    <div class="who">
      <div class="nm">${esc(p.name)}</div>
      <div class="sb">${esc(p.tm)} &middot; ${esc(p.posRank)}</div>
    </div>
    <div class="pr">
      <div class="p">${money(p.price)}</div>
      <div class="c ${d}">${tri(p.pct)} ${pctText(Math.abs(p.pct))}</div>
    </div>
    ${thumb(p, mode)}
    ${starCell(p)}
  </div>`;
}

/** A row on the Portfolio screen: signed position, live mark, today's change,
 *  total value. A negative position carries its minus and its colour here the
 *  same way it does everywhere else. */
export function holdingRow(p) {
  const d = dirClass(p.dayChange);
  return `<div class="mk-row" onclick="mkOpenPlayer('${p.id}')">
    <div class="bar" style="background:${p.color}"></div>
    ${face(p)}
    <div class="who">
      <div class="nm">${esc(p.name)}</div>
      <div class="sb">${esc(p.pos)} &middot; ${esc(p.tm)}</div>
      <span class="chip ${qtyClass(p.qty)}">${qtyText(p.qty)}</span>
    </div>
    <div class="pr">
      <div class="p">${money(p.price)}</div>
      <div class="c ${dirClass(p.pct)}">${tri(p.pct)} ${pctText(Math.abs(p.pct))}</div>
    </div>
    <div class="dc">
      <div class="d ${d}">${signed(p.dayChange)}</div>
      <div class="q">${money(Math.abs(p.value))}</div>
    </div>
  </div>`;
}

export function empty(icon, title, sub) {
  return `<div class="mk-empty">${icon}<div class="t">${esc(title)}</div><div class="s">${sub}</div></div>`;
}
