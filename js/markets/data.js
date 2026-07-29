// Arc Markets — the market model.
//
// Deliberately independent of the fantasy side: this imports only from js/data/
// (plain NFL facts) and keeps its own localStorage key. Nothing here reads or
// writes league settings, rosters, lineups or scoring.
//
// The pricing rule comes straight from the concept: a contract settles on the
// player's official season production, at 100 points per dollar. So a player
// projected for 328 season points prices near $3.28, and the payout at the end
// of the year is simply their real total divided by 100. No house, no odds.
import { NFL_PLAYERS } from '../data/nfl-players.js';
import { teamColor } from '../data/nfl-colors.js';

export const POINTS_PER_DOLLAR = 100;
export const SHARES_PER_LOT = 50;      // every seeded holding is one 50-share lot
export const HOLDING_COUNT = 28;
const STORE_KEY = 'arc_markets_v1';

// ---------------------------------------------------------------- seeded noise
// The prototype has no backend, so every "live" number is derived from the
// player's id. Same player, same numbers, every load - which keeps screenshots
// and demos stable.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- persistence
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
export const mkStore = load();
mkStore.watch = mkStore.watch || [];
export function saveMk() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(mkStore)); } catch (e) { /* quota */ }
}

// ---------------------------------------------------------------- the universe
function build() {
  const pool = NFL_PLAYERS
    .filter(p => p.sproj > 60 && ['QB', 'RB', 'WR', 'TE'].includes(p.pos))
    .sort((a, b) => b.sproj - a.sproj)
    .slice(0, 150);

  const rank = {};   // running count per position, for the WR1 / RB2 label
  return pool.map(p => {
    const r = rng(hash(p.id));
    const price = Math.round(p.sproj / POINTS_PER_DOLLAR * 100) / 100;

    // day move: mostly small, occasionally a real swing, with a slight upward
    // bias so the market reads as a green day rather than netting to zero
    const swing = r() < 0.18 ? 5.5 : 2.2;
    const pct = Math.round(((r() * 2 - 1) * swing + 0.75) * 10) / 10;
    const change = Math.round(price * pct) / 100;      // dollars moved today

    rank[p.pos] = (rank[p.pos] || 0) + 1;

    return {
      id: p.id, name: p.full || p.n, short: p.n, pos: p.pos, tm: p.tm, hs: p.hs,
      exp: p.exp,
      color: teamColor(p.tm),
      posRank: p.pos + rank[p.pos],
      sproj: p.sproj,
      price, pct, change,
      // heavily skewed: a handful of names carry most of the day's activity
      trades: 25 + Math.floor(Math.pow(r(), 4) * 12400),
      spark: sparkline(p.id, pct),
    };
  });
}

// 24 points whose overall direction matches the day's move.
//
// A plain random walk accumulates drift and regularly ends up pointing the wrong
// way, which reads as a bug next to a red percentage. So the jitter is
// independent per point (it cannot accumulate) and a linear ramp carries the
// trend, scaled so it stays legible even on a small move.
function sparkline(id, pct) {
  const r = rng(hash(id + '#spark'));
  const n = 24;
  const jitter = Array.from({ length: n }, () => (r() * 2 - 1) * 6);
  const ramp = Math.sign(pct || 1) * (3 + Math.abs(pct) * 2.2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const smooth = (jitter[i] + (jitter[i - 1] ?? jitter[i]) + (jitter[i + 1] ?? jitter[i])) / 3;
    out.push(50 + smooth + ramp * (i / (n - 1)));
  }
  const lo = Math.min(...out), hi = Math.max(...out), span = hi - lo || 1;
  return out.map(v => Math.round(((v - lo) / span) * 100) / 100);
}

export const MARKET = build();
export const BY_ID = Object.fromEntries(MARKET.map(p => [p.id, p]));

// ---------------------------------------------------------------- market stats
export function marketStats() {
  const trades = MARKET.reduce((n, p) => n + p.trades, 0);
  return {
    trades,
    volumePct: 18,
    open: true,
  };
}

export function topMover(dir) {
  return [...MARKET].sort((a, b) => dir > 0 ? b.pct - a.pct : a.pct - b.pct)[0];
}
export function mostActive() {
  return [...MARKET].sort((a, b) => b.trades - a.trades)[0];
}
export function topRookie() {
  const rookies = MARKET.filter(p => p.exp <= 1);
  return [...rookies].sort((a, b) => b.pct - a.pct)[0] || MARKET[0];
}

// ---------------------------------------------------------------- the holdings
// Seeded so the portfolio has something to show. One 50-share lot in each of the
// most valuable contracts.
export const HOLDINGS = MARKET.slice(0, HOLDING_COUNT)
  .map(p => ({ id: p.id, shares: SHARES_PER_LOT }));

export function holdingRows() {
  return HOLDINGS.map(h => {
    const p = BY_ID[h.id];
    return { ...p, shares: h.shares,
             value: Math.round(p.price * h.shares * 100) / 100,
             dayChange: Math.round(p.change * h.shares * 100) / 100 };
  });
}

export function portfolio() {
  const rows = holdingRows();
  const value = rows.reduce((n, r) => n + r.value, 0);
  const dayChange = rows.reduce((n, r) => n + r.dayChange, 0);
  const open = value - dayChange;
  return {
    rows,
    value: Math.round(value * 100) / 100,
    dayChange: Math.round(dayChange * 100) / 100,
    dayPct: Math.round((dayChange / (open || 1)) * 1000) / 10,
    series: portfolioSeries(value, dayChange),
  };
}

// A day's worth of portfolio value, ending exactly on today's number.
function portfolioSeries(value, dayChange) {
  const r = rng(hash('arc-portfolio'));
  const start = value - dayChange;
  const n = 64, out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(start + dayChange * t + (r() * 2 - 1) * Math.abs(dayChange) * 0.16 * (1 - t * 0.3));
  }
  out[n - 1] = value;
  const lo = Math.min(...out), hi = Math.max(...out), span = hi - lo || 1;
  return out.map(v => Math.round(((v - lo) / span) * 100) / 100);
}

// ---------------------------------------------------------------- watchlist
export function isWatched(id) { return mkStore.watch.includes(id); }
export function toggleWatch(id) {
  const i = mkStore.watch.indexOf(id);
  if (i > -1) mkStore.watch.splice(i, 1); else mkStore.watch.push(id);
  saveMk();
  return isWatched(id);
}
export function watchRows() { return mkStore.watch.map(id => BY_ID[id]).filter(Boolean); }

// ---------------------------------------------------------------- the season
// Markets keeps its own clock. The fantasy side of the app sits at week 1
// pregame, but a contract with no games behind it has nothing to chart - the
// game log is empty and the pace line is flat at zero. So the market runs at a
// point in the season where the charts say something. Wire this to the real
// week when there is a live season behind it.
export const SEASON_GAMES = 17;
export const WEEKS_PLAYED = 8;

// A player's season, week by week. Weekly fantasy scoring is wildly uneven -
// the same player puts up 4 and 31 a fortnight apart - so the spread here is
// deliberately wide, with the mean tracking the season projection.
const logCache = {};
export function gameLog(p) {
  if (logCache[p.id]) return logCache[p.id];
  const r = rng(hash(p.id + '#log'));
  const perGame = p.sproj / SEASON_GAMES;
  const raw = [];
  for (let w = 0; w < SEASON_GAMES; w++) {
    // two rolls averaged, so most weeks land near the mean and the tails are
    // reachable rather than uniform; the occasional roll adds a real spike
    const base = (r() + r()) / 2;
    const spike = r() < 0.12 ? 0.55 + r() * 0.7 : 0;
    raw.push(Math.max(0, perGame * (0.28 + base * 1.42 + spike)));
  }
  // rescale so the season really does add up to the projection
  const scale = p.sproj / (raw.reduce((n, v) => n + v, 0) || 1);
  const out = raw.map((v, i) => ({ week: i + 1, pts: Math.round(v * scale * 10) / 10 }));
  logCache[p.id] = out;
  return out;
}

// A daily price path across the season so far. Game days move the price by how
// far that game landed from expectation; the days between drift. The whole path
// is then scaled so it ends exactly on today's quoted price - the history has to
// agree with the number on the row.
const dayCache = {};
export function priceDays(p) {
  if (dayCache[p.id]) return dayCache[p.id];
  const r = rng(hash(p.id + '#px'));
  const log = gameLog(p), perGame = p.sproj / SEASON_GAMES;
  const out = [];
  let v = 1;
  for (let w = 0; w < WEEKS_PLAYED; w++) {
    for (let d = 0; d < 7; d++) {
      if (d === 0) {
        const surprise = (log[w].pts - perGame) / (perGame || 1);
        v *= 1 + Math.max(-0.2, Math.min(0.2, surprise * 0.14));
      } else {
        v *= 1 + (r() * 2 - 1) * 0.011;
      }
      out.push({ v, w, game: d === 0, pts: d === 0 ? log[w].pts : null });
    }
  }
  const k = p.price / (out[out.length - 1].v || 1);
  out.forEach(x => { x.v = Math.round(x.v * k * 10000) / 10000; });
  dayCache[p.id] = out;
  return out;
}

/**
 * One closing price per season the player has been in the league, ending today.
 *
 * Built forward along a career arc rather than by walking backwards from today:
 * cheap as a rookie, steepest gains in years two and three, a plateau around
 * year five, a taper after. The whole curve is then scaled so the final year is
 * exactly today's quote, which is what makes the chart honest at the right edge.
 */
export function careerSeries(p) {
  const r = rng(hash(p.id + '#career'));
  const yrs = Math.max(1, Math.min(9, p.exp || 1));
  const raw = [];
  for (let i = 0; i <= yrs; i++) {
    const arc = 0.40 + 0.72 * (1 - Math.pow((i - 5) / 6, 2));
    raw.push({ year: 2026 - yrs + i, v: Math.max(0.15, arc * (0.9 + r() * 0.2)) });
  }
  const k = p.price / (raw[raw.length - 1].v || 1);
  return raw.map(o => ({ year: o.year, price: Math.round(o.v * k * 100) / 100 }));
}

// ---------------------------------------------------------------- career curve
// The concept's "shape of a career": the same player priced for three seasons.
// Younger players carry a premium further out, veterans a discount.
export function seasonCurve(p) {
  const r = rng(hash(p.id + '#curve'));
  const young = p.exp <= 3;
  return [2026, 2027, 2028].map((yr, i) => {
    const drift = i === 0 ? 0 : (young ? 0.06 + r() * 0.05 : -0.07 - r() * 0.05) * i;
    return { year: yr, price: Math.round(p.price * (1 + drift) * 100) / 100 };
  });
}
