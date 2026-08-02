// Arc Markets — contracts: what is actually being traded.
//
// A contract is a player plus a term. Its symbol is `<playerId>@<term>`, which
// is the key every engine book, position and order is filed under. Two terms on
// the same player are two instruments with two independent prices — but, per
// the no-hedge rule, one shared direction (see ledger.js).
//
// The market is GLOBAL. A contract belongs to the platform, not to a league:
// every user trades the same symbol at the same price regardless of which
// fantasy leagues they are in. Nothing in this folder reads league state.
import { NFL_PLAYERS } from '../data/nfl-players.js';
import { HIST_SRC, HIST_SEASONS } from '../data/nfl-history.js';

export const SEASON = 2026;               // the season now being traded
export const POINTS_PER_DOLLAR = 100;     // settlement: points / 100 = dollars

// ---------------------------------------------------------------- terms
// `years` is how many seasons of production the contract settles on.
export const TERMS = [
  { key: 'season', years: 1, label: 'Current Season', short: '1Y',
    desc: `Settles on ${SEASON} production.` },
  { key: '2yr', years: 2, label: '2 Years', short: '2Y',
    desc: `Settles on ${SEASON}–${SEASON + 1} combined production.` },
  { key: '3yr', years: 3, label: '3 Years', short: '3Y',
    desc: `Settles on ${SEASON}–${SEASON + 2} combined production.` },
  { key: '5yr', years: 5, label: '5 Years', short: '5Y', top100: true,
    desc: `Settles on ${SEASON}–${SEASON + 4} combined production. Top 100 only.` },
];
export const TERM_BY_KEY = Object.fromEntries(TERMS.map(t => [t.key, t]));
export const DEFAULT_TERM = 'season';

export function symbolFor(playerId, term) { return `${playerId}@${term || DEFAULT_TERM}`; }
export function parseSymbol(sym) {
  const i = String(sym).lastIndexOf('@');
  return i < 0 ? { playerId: sym, term: DEFAULT_TERM }
               : { playerId: sym.slice(0, i), term: sym.slice(i + 1) };
}

// ---------------------------------------------------------------- top 100
// "Determined before each season begins based on the previous year's
// performance." So it is computed once, from the last completed season's real
// PPR totals, and then held fixed for the season — it must not drift as the
// current year plays out, or a contract could lose its eligibility mid-life.
const SKILL = ['QB', 'RB', 'WR', 'TE'];

function buildTop100() {
  const prevSeason = HIST_SEASONS[0];                      // most recent completed year
  const rows = String(HIST_SRC[prevSeason] || '').trim().split('\n').map(line => {
    const [name, pos, team, games, ppr, standard, id] = line.split('|');
    return { name, pos, id: (id || '').trim(), ppr: parseFloat(ppr) || 0 };
  });
  const ranked = rows
    .filter(r => r.id && SKILL.includes(r.pos))            // still active, skill position
    .sort((a, b) => b.ppr - a.ppr)
    .slice(0, 100);
  return { season: prevSeason, ids: new Set(ranked.map(r => r.id)),
           rank: Object.fromEntries(ranked.map((r, i) => [r.id, i + 1])) };
}
const TOP100 = buildTop100();

export function isTop100(playerId) { return TOP100.ids.has(playerId); }
export function top100Rank(playerId) { return TOP100.rank[playerId] || null; }
export function top100Season() { return TOP100.season; }

/** The terms a given player can actually be traded on. */
export function termsFor(playerId) {
  return TERMS.filter(t => !t.top100 || isTop100(playerId));
}
export function termAvailable(playerId, term) {
  const t = TERM_BY_KEY[term];
  return !!t && (!t.top100 || isTop100(playerId));
}

// ---------------------------------------------------------------- lifetime
/** Seasons a contract settles across, inclusive. */
export function contractSeasons(term, startSeason) {
  const t = TERM_BY_KEY[term] || TERM_BY_KEY[DEFAULT_TERM];
  const s0 = startSeason || SEASON;
  return Array.from({ length: t.years }, (_, i) => s0 + i);
}
export function expirySeason(term, startSeason) {
  const s = contractSeasons(term, startSeason);
  return s[s.length - 1];
}

// ---------------------------------------------------------------- valuation
// The projection is the contract's intrinsic value — the reference the market
// trades around. It is NOT the price: price comes from the tape (engine.js).
// Multi-year terms discount later seasons, because production further out is
// less certain, not because anyone decided the price.
const AGE_CURVE = [1, 0.97, 0.93, 0.88, 0.82];

export function intrinsic(player, term) {
  const t = TERM_BY_KEY[term] || TERM_BY_KEY[DEFAULT_TERM];
  const perSeason = player.sproj || 0;
  let pts = 0;
  for (let i = 0; i < t.years; i++) pts += perSeason * (AGE_CURVE[i] != null ? AGE_CURVE[i] : 0.78);
  return { points: Math.round(pts * 10) / 10, value: Math.round(pts / POINTS_PER_DOLLAR * 100) / 100 };
}

// ---------------------------------------------------------------- settlement
// A contract settles the moment its term ends OR the player retires — whichever
// comes first — on official production for the period covered so far.
//
// NFL team changes are explicitly NOT settlement events. A trade, a release, a
// waiver claim or a free-agent signing leaves the contract untouched: the
// instrument tracks the player, not the roster spot.
export const SETTLE_EXPIRY = 'expiry';
export const SETTLE_RETIRED = 'retired';

/**
 * @param actuals {seasonYear: officialPoints} real production, by season
 * @returns {settled, reason, points, value, seasons} — `value` is per share.
 */
export function settlementFor(term, startSeason, actuals, retired) {
  const seasons = contractSeasons(term, startSeason);
  const done = seasons.filter(y => actuals && actuals[y] != null);
  const complete = done.length === seasons.length;
  if (!complete && !retired) {
    return { settled: false, reason: null, points: 0, value: 0, seasons, done };
  }
  const points = done.reduce((n, y) => n + (actuals[y] || 0), 0);
  return {
    settled: true,
    reason: complete ? SETTLE_EXPIRY : SETTLE_RETIRED,
    points: Math.round(points * 10) / 10,
    value: Math.round(points / POINTS_PER_DOLLAR * 100) / 100,
    seasons, done,
  };
}

/** True for roster moves that must never disturb an open contract. */
export const ROSTER_MOVES = ['trade', 'free-agency', 'waived', 'signed', 'depth-chart'];
export function affectsContract(eventKind) {
  return eventKind === 'retirement';        // the only player event that settles
}

// ---------------------------------------------------------------- universe
/** Tradable players: skill positions with enough projected volume to matter. */
export function tradableUniverse(limit = 150) {
  return NFL_PLAYERS
    .filter(p => p.sproj > 60 && SKILL.includes(p.pos))
    .sort((a, b) => b.sproj - a.sproj)
    .slice(0, limit);
}
