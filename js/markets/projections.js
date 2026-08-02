// Arc Markets — season-long PPR projections.
//
// Projections are INFORMATIONAL. They are the contract's intrinsic value and
// they are what participants argue about, but nothing here writes a price:
// a projection change publishes an event, participants read it, and their
// orders move the market. There is deliberately no path from this file to a
// price — see flow.js for the only route.
//
// The provider is pluggable. Swapping Sleeper for FantasyPros (or a blend, or a
// live feed) means registering another source here; no caller changes, because
// everything reads projectionFor() / subscribe().
import { NFL_BY_ID } from '../data/nfl-players.js';
import { publish } from './events.js';
import { tradableUniverse } from './contracts.js';

// ---------------------------------------------------------------- providers
// Each provider implements: fetch() -> {playerId: seasonPointsPPR}
// The bundled one reads the app's own modelled numbers, which stand in for a
// real feed; `registerProvider` is how a live one is dropped in.
const providers = {};
export function registerProvider(name, impl) { providers[name] = impl; }
export function listProviders() { return Object.keys(providers); }

registerProvider('bundled', {
  label: 'Bundled model',
  async fetch() {
    const out = {};
    tradableUniverse().forEach(p => { out[p.id] = p.sproj; });
    return out;
  },
});

// A live provider would look exactly like this. Left registered but unselected
// so the wiring is visible and switching is a one-line change.
registerProvider('sleeper', {
  label: 'Sleeper',
  endpoint: 'https://api.sleeper.app/v1/projections/nfl/regular/2026',
  async fetch() {
    const res = await fetch(this.endpoint);
    if (!res.ok) throw new Error('projection feed unavailable');
    const raw = await res.json();
    const out = {};
    Object.entries(raw || {}).forEach(([id, row]) => {
      if (row && row.pts_ppr != null) out[id] = row.pts_ppr;
    });
    return out;
  },
});

let active = 'bundled';
export function setProvider(name) { if (providers[name]) active = name; return active; }
export function activeProvider() { return active; }
export function providerLabel() { return (providers[active] || {}).label || active; }

// ---------------------------------------------------------------- store
const proj = {};             // playerId -> current season projection (PPR points)
const prev = {};             // last value, so a change can be reported
let updatedAt = null;
const subs = [];

export function projectionFor(playerId) {
  if (proj[playerId] != null) return proj[playerId];
  const p = NFL_BY_ID[playerId];
  return p ? p.sproj : 0;
}
export function projectionChange(playerId) {
  if (prev[playerId] == null || proj[playerId] == null) return 0;
  return Math.round((proj[playerId] - prev[playerId]) * 10) / 10;
}
export function lastUpdated() { return updatedAt; }
export function subscribe(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i > -1) subs.splice(i, 1); }; }

/** Apply a batch of projections and announce anything that moved. */
export function applyProjections(map) {
  const moved = [];
  Object.entries(map || {}).forEach(([id, pts]) => {
    const before = proj[id];
    if (before != null && Math.abs(pts - before) < 0.05) return;
    if (before != null) {
      prev[id] = before;
      moved.push({ id, from: before, to: pts });
    }
    proj[id] = pts;
  });
  updatedAt = Date.now();
  // A revision is news. It reaches the market only as an event participants read.
  moved.forEach(m => {
    const delta = m.to - m.from;
    publish({
      kind: 'projection', playerId: m.id,
      text: `${providerLabel()} projection ${delta > 0 ? 'raised' : 'cut'} to ${m.to.toFixed(1)}`,
      sentiment: Math.max(-1.4, Math.min(1.4, (delta / Math.max(1, m.from)) * 9)),
    });
  });
  subs.forEach(cb => { try { cb(moved); } catch (e) {} });
  return moved;
}

/** Pull once from the active provider. Falls back silently if a feed is down. */
export async function refreshProjections() {
  const p = providers[active];
  if (!p) return [];
  try { return applyProjections(await p.fetch()); }
  catch (e) { return []; }
}

// ---------------------------------------------------------------- live updates
// "Update in real time whenever new data becomes available." A real deployment
// subscribes to a push feed; polling is the portable fallback, and both land in
// applyProjections() so the downstream behaviour is identical.
let poll = null;
export function startProjectionFeed({ intervalMs = 60000 } = {}) {
  refreshProjections();
  if (poll) clearInterval(poll);
  poll = setInterval(refreshProjections, intervalMs);
  return poll;
}
export function stopProjectionFeed() { if (poll) clearInterval(poll); poll = null; }

/** Push a single revision in, as a live socket would. */
export function pushProjection(playerId, points) {
  return applyProjections({ [playerId]: points });
}
