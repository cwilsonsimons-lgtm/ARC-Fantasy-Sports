// Sleeper API client. Sleeper's public API is read-only, keyless and allows
// cross-origin requests, so the browser calls it directly.
//
// Rejected offers are not in it — Sleeper never exposes declined or pending
// trades — which is why the Trades tab has a form for logging them.

const API = 'https://api.sleeper.app/v1';
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE']);

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
  return res.json();
}

export const getState = () => get('/state/nfl');
export const getLeague = id => get(`/league/${id}`);
export const getUsers = id => get(`/league/${id}/users`);
export const getRosters = id => get(`/league/${id}/rosters`);
export const getTransactions = (id, week) => get(`/league/${id}/transactions/${week}`);

// The full player table is several MB; keep only fantasy positions and the
// fields the tool shows.
export async function getPlayers() {
  const all = await get('/players/nfl');
  const out = {};
  for (const id in all) {
    const p = all[id];
    const pos = p.fantasy_positions?.find(x => FANTASY.has(x)) || p.position;
    if (!FANTASY.has(pos)) continue;
    if (!p.team && p.status !== 'Active' && !(p.years_exp <= 1)) continue;
    out[id] = { name: p.full_name || `${p.first_name} ${p.last_name}`, pos, team: p.team || 'FA', age: p.age ?? null };
  }
  return out;
}

// Stat and projection endpoints return either { id: stats } or [{ player_id, stats }].
function normalizeStats(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (const r of raw) if (r?.player_id && r.stats) out[r.player_id] = r.stats;
  } else if (raw && typeof raw === 'object') {
    for (const id in raw) out[id] = raw[id];
  }
  return out;
}

export async function getWeekStats(season, week) {
  return normalizeStats(await get(`/stats/nfl/regular/${season}/${week}`));
}
export async function getWeekProjections(season, week) {
  try { return normalizeStats(await get(`/projections/nfl/regular/${season}/${week}`)); }
  catch { return {}; }       // projections are a nice-to-have; form falls back to averages
}

// Every season of a dynasty league is its own league id, chained backwards.
export async function getLeagueChain(id, seasons) {
  const chain = [];
  let cur = id;
  while (cur && cur !== '0' && chain.length < seasons) {
    const lg = await getLeague(cur);
    chain.push(lg);
    cur = lg.previous_league_id;
  }
  return chain;
}

// Completed trades as { id, date, sides: [{ roster, gets: [key] }] }.
export function parseTrades(txns, pickKey) {
  const out = [];
  for (const t of txns) {
    if (t.type !== 'trade' || t.status !== 'complete') continue;
    const sides = new Map((t.roster_ids || []).map(r => [r, []]));
    const side = r => sides.get(r) || sides.set(r, []).get(r);
    for (const [pid, r] of Object.entries(t.adds || {})) side(r).push(pid);
    for (const p of t.draft_picks || []) side(p.owner_id).push(pickKey(p.season, p.round));
    // FAAB sweeteners are ignored: they're small and not on the value scale.
    out.push({
      id: String(t.transaction_id),
      date: t.status_updated || t.created,
      sides: [...sides].map(([roster, gets]) => ({ roster, gets })),
    });
  }
  return out;
}

// Week w's games are final by the Tuesday after. Week 1 kicks off the Thursday
// after Labor Day (first Monday in September), so it ends Labor Day + 8 days.
export function weekEnd(season, week) {
  const sep1 = new Date(Date.UTC(+season, 8, 1));
  const laborDay = 1 + ((8 - sep1.getUTCDay()) % 7);
  return Date.UTC(+season, 8, laborDay + 8 + 7 * (week - 1), 12);
}
