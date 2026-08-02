// Arc Markets — the tape, turned into the numbers a trading screen shows.
//
// Two sources, one series. The seeded daily path in data.js is the market's
// history *before* this session opened; the engine's live prints are what has
// happened since. Charts read them as a single continuous line, which is why a
// 1-day view can be live-updating while a season view still has a season in it.
//
// Nothing here decides a price either — it only reads the tape.
import { getEngine, round2 } from './engine.js';
import { DEFAULT_TERM, parseSymbol, symbolFor } from './contracts.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// sym -> [{t, v}] live samples, oldest first
const live = {};
// sym -> [{t, v}] backfilled history (set once from the seeded season path)
const hist = {};

export function seedHistory(sym, points) {
  if (!hist[sym]) hist[sym] = points.slice();
  return hist[sym];
}
export function hasHistory(sym) { return !!hist[sym]; }

/** Sample the current price. Called on every flow tick. */
export function record(sym, px) {
  const arr = live[sym] || (live[sym] = []);
  const now = Date.now();
  const lastPt = arr[arr.length - 1];
  // don't store a point per tick forever — thin to one every 20s once dense
  if (lastPt && now - lastPt.t < 20000 && arr.length > 4) { lastPt.v = px; lastPt.t = now; return; }
  arr.push({ t: now, v: px });
  if (arr.length > 3000) arr.splice(0, arr.length - 3000);
}
export function recordAll() {
  const eng = getEngine();
  Object.keys(eng.books).forEach(sym => {
    const b = eng.books[sym];
    if (b && b.last != null) record(sym, b.last);
  });
}

/** History + live, as one array of {t, v}. */
export function fullSeries(sym) {
  return (hist[sym] || []).concat(live[sym] || []);
}

// ---------------------------------------------------------------- ranges
export const RANGES = [
  ['1d',       '1D',       'Today'],
  ['1w',       '1W',       'This week'],
  ['1m',       '1M',       'This month'],
  ['season',   'Season',   'The season so far'],
  ['contract', 'Contract', 'The life of this contract'],
  ['all',      'All',      'Every season traded'],
];

const SPANS = { '1d': DAY, '1w': 7 * DAY, '1m': 30 * DAY, season: 240 * DAY };

/** Points for a chart range, already trimmed and thinned for drawing. */
export function seriesFor(sym, range, opts = {}) {
  const all = fullSeries(sym);
  if (!all.length) return [];
  const now = Date.now();
  let cut = all;
  if (SPANS[range]) cut = all.filter(p => p.t >= now - SPANS[range]);
  else if (range === 'contract' && opts.openedAt) cut = all.filter(p => p.t >= opts.openedAt);
  // 'all' keeps everything
  if (cut.length < 2) cut = all.slice(-2);
  return thin(cut, range === '1d' ? 90 : 120);
}
function thin(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

/** Price as of `ms` ago, for a change calculation. */
function priceAgo(sym, ms) {
  const all = fullSeries(sym);
  if (!all.length) return null;
  const cutoff = Date.now() - ms;
  for (let i = all.length - 1; i >= 0; i--) if (all[i].t <= cutoff) return all[i].v;
  return all[0].v;
}
function pctFrom(now, then) {
  if (then == null || !then) return 0;
  return round2(((now - then) / then) * 100);
}

// ---------------------------------------------------------------- the panel
/** Everything the player page's market block displays, in one call. */
export function quoteStats(playerId, term) {
  const sym = symbolFor(playerId, term || DEFAULT_TERM);
  const eng = getEngine();
  const q = eng.quote(sym);
  const st = eng.stats(sym);
  const last = q ? (q.last != null ? q.last : q.mid) : 0;
  const d = priceAgo(sym, DAY), w = priceAgo(sym, 7 * DAY), m = priceAgo(sym, 30 * DAY);
  return {
    sym, price: last, bid: q ? q.bid : null, ask: q ? q.ask : null,
    spread: q ? q.spread : null, mid: q ? q.mid : null, last,
    dayChange: d == null ? 0 : round2(last - d), dayPct: pctFrom(last, d),
    weekChange: w == null ? 0 : round2(last - w), weekPct: pctFrom(last, w),
    monthChange: m == null ? 0 : round2(last - m), monthPct: pctFrom(last, m),
    volume: st.vol, trades: st.trades, buyVol: st.buyVol, sellVol: st.sellVol,
    buyRatio: st.buyRatio, depth: q ? q.depth : [],
    engine: eng.kind,
  };
}

/** Market-wide session numbers for the strip at the top of the Market screen. */
export function marketTotals() {
  const eng = getEngine();
  let trades = 0, vol = 0, buy = 0, sell = 0;
  Object.keys(eng.books).forEach(sym => {
    const s = eng.stats(sym);
    trades += s.trades; vol += s.vol; buy += s.buyVol; sell += s.sellVol;
  });
  return { trades, volume: Math.round(vol), buyVol: buy, sellVol: sell,
           buyRatio: (buy + sell) ? buy / (buy + sell) : 0.5, engine: eng.kind };
}
