// Arc Markets — the event feed.
//
// Events never touch a price. They are published here, participants read them
// (flow.js) and decide whether to trade, and only those trades move the market.
// That indirection is the whole point: nothing in this file can write a price.
//
// Every event carries a TIER, which is what lets one feed drive every chart
// range without cluttering the long ones:
//   3 intraday  — touchdowns, single-game lines, minor news
//   2 season    — injuries, trades, depth-chart changes, real news
//   1 career    — season-ending injuries, team changes, MVPs, records, retirement
// A 1-day chart draws tiers 1-3; a season chart drops tier 3; a multi-year or
// all-time chart draws tier 1 only.
import { tradableUniverse } from './contracts.js';

export const TIER_INTRADAY = 3, TIER_SEASON = 2, TIER_CAREER = 1;

export const KINDS = {
  touchdown:   { tier: TIER_INTRADAY, label: 'Touchdown',        icon: '🏈', tone: 'up' },
  bigplay:     { tier: TIER_INTRADAY, label: 'Big play',         icon: '⚡', tone: 'up' },
  news:        { tier: TIER_INTRADAY, label: 'News',             icon: '📰', tone: 'flat' },
  injury:      { tier: TIER_SEASON,   label: 'Injury',           icon: '🚑', tone: 'down' },
  depthchart:  { tier: TIER_SEASON,   label: 'Depth chart',      icon: '📋', tone: 'flat' },
  trade:       { tier: TIER_SEASON,   label: 'Trade',            icon: '🔁', tone: 'flat' },
  projection:  { tier: TIER_SEASON,   label: 'Projection update',icon: '📈', tone: 'flat' },
  seasonEnding:{ tier: TIER_CAREER,   label: 'Season-ending injury', icon: '🏥', tone: 'down' },
  teamChange:  { tier: TIER_CAREER,   label: 'Team change',      icon: '✈️', tone: 'flat' },
  award:       { tier: TIER_CAREER,   label: 'Award',            icon: '🏆', tone: 'up' },
  record:      { tier: TIER_CAREER,   label: 'Record',           icon: '📜', tone: 'up' },
  retirement:  { tier: TIER_CAREER,   label: 'Retirement',       icon: '🎬', tone: 'down' },
};

// Sentiment is how strongly an event pushes participants, not how far a price
// moves. flow.js turns this into orders; the market turns orders into a price.
const SENTIMENT = {
  touchdown: 0.35, bigplay: 0.22, news: 0, injury: -0.8, depthchart: -0.15,
  trade: 0.05, projection: 0.3, seasonEnding: -2.4, teamChange: 0.1,
  award: 0.7, record: 0.6, retirement: -3,
};

const feed = [];            // newest last
const byPlayer = {};

export function publish(ev) {
  const k = KINDS[ev.kind];
  if (!k) return null;
  const e = {
    id: 'e' + feed.length + '-' + Math.random().toString(36).slice(2, 7),
    ts: ev.ts || Date.now(), kind: ev.kind, tier: k.tier, playerId: ev.playerId,
    text: ev.text || k.label, sentiment: ev.sentiment != null ? ev.sentiment : SENTIMENT[ev.kind] || 0,
    consumed: false,
  };
  feed.push(e);
  (byPlayer[e.playerId] = byPlayer[e.playerId] || []).push(e);
  if (feed.length > 1200) feed.splice(0, feed.length - 1200);
  return e;
}

export function eventsFor(playerId, { maxTier = TIER_INTRADAY, since = 0 } = {}) {
  return (byPlayer[playerId] || []).filter(e => e.tier <= maxTier && e.ts >= since);
}
export function recentFeed(n = 40) { return feed.slice(-n).reverse(); }
/** Events participants have not reacted to yet. */
export function pending() { return feed.filter(e => !e.consumed); }
export function consume(e) { e.consumed = true; }

/** Highest tier of detail a chart range should draw. */
export function tierForRange(range) {
  if (range === '1d' || range === '1w') return TIER_INTRADAY;
  if (range === '1m' || range === 'season' || range === 'contract') return TIER_SEASON;
  return TIER_CAREER;                                    // 'all'
}

// ---------------------------------------------------------------- seeding
// Backfill a plausible history so charts have markers on first load. Seeded
// from player id, so the same player shows the same story every time.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = 86400000;

export function seedHistory(weeksPlayed = 8) {
  const now = Date.now();
  tradableUniverse().forEach((p, idx) => {
    const r = rng(hash(p.id + '#ev'));
    // career-tier backdrop, spread across previous seasons
    if (r() < 0.30) publish({ kind: 'teamChange', playerId: p.id, ts: now - DAY * (400 + r() * 900),
                              text: `Signed with ${p.tm}` });
    if (idx < 12 && r() < 0.5) publish({ kind: 'award', playerId: p.id, ts: now - DAY * (300 + r() * 500),
                                         text: 'All-Pro selection' });
    if (r() < 0.12) publish({ kind: 'seasonEnding', playerId: p.id, ts: now - DAY * (380 + r() * 400),
                              text: 'Missed the rest of the season' });
    // this season
    for (let w = 0; w < weeksPlayed; w++) {
      const ts = now - DAY * ((weeksPlayed - w) * 7);
      const tds = Math.floor(Math.pow(r(), 1.6) * 3);
      for (let i = 0; i < tds; i++)
        publish({ kind: 'touchdown', playerId: p.id, ts: ts + i * 900000, text: `Touchdown · week ${w + 1}` });
      if (r() < 0.10) publish({ kind: 'injury', playerId: p.id, ts: ts + DAY, text: 'Listed as questionable' });
      if (r() < 0.06) publish({ kind: 'depthchart', playerId: p.id, ts: ts + DAY, text: 'Role change on the depth chart' });
      if (r() < 0.05) publish({ kind: 'trade', playerId: p.id, ts: ts + DAY * 2, text: 'Involved in a trade' });
      if (r() < 0.14) publish({ kind: 'news', playerId: p.id, ts: ts + DAY * 3, text: 'Beat-writer report' });
    }
    feed.forEach(e => { e.consumed = true; });     // history is already priced in
  });
}
