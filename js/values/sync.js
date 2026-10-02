// Pulls everything the model needs from Sleeper into the cache. Finished seasons
// and finished weeks never change, so they're fetched once.

import * as sl from './sleeper.js';
import { leaguePoints, pprPoints } from './scoring.js';
import { pickKey } from './model.js';
import { cache, data, saveCache } from './store.js';

const LAST_WEEK = 18;

async function pool(jobs, size = 6) {
  const out = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (i < jobs.length) { const j = i++; out[j] = await jobs[j](); }
  }));
  return out;
}

export async function sync(progress = () => {}) {
  if (!data.leagueId) throw new Error('Enter your Sleeper league ID first');
  progress('Reading league…');
  const state = await sl.getState();
  const chain = await sl.getLeagueChain(data.leagueId.trim(), Math.max(1, data.seasons));
  const current = chain[0];

  const scoringHash = JSON.stringify(current.scoring_settings || {});
  if (scoringHash !== cache.scoringHash) { cache.weeks = {}; cache.scoringHash = scoringHash; }

  const [users, rosters] = await Promise.all([sl.getUsers(current.league_id), sl.getRosters(current.league_id)]);
  cache.users = users;
  cache.rosters = rosters;
  cache.leagues = chain.map(l => ({
    league_id: l.league_id, name: l.name, season: l.season, status: l.status,
    total_rosters: l.total_rosters, roster_positions: l.roster_positions,
    scoring_settings: l.scoring_settings, settings: { type: l.settings?.type },
  }));

  if (Date.now() - cache.playersAt > 86400000 || !Object.keys(cache.players).length) {
    progress('Downloading Sleeper players (a few MB, once a day)…');
    cache.players = await sl.getPlayers();
    cache.playersAt = Date.now();
  }

  // Trades. A complete season's list is final.
  for (const lg of chain) {
    if (lg.status === 'complete' && cache.trades[lg.league_id]) continue;
    progress(`Reading ${lg.season} trades…`);
    const weeks = await pool(Array.from({ length: LAST_WEEK + 1 }, (_, w) => () => sl.getTransactions(lg.league_id, w).catch(() => [])));
    const seen = new Set();
    cache.trades[lg.league_id] = sl.parseTrades(weeks.flat(), pickKey).filter(t => !seen.has(t.id) && seen.add(t.id));
  }

  // Weekly points under this league's scoring.
  const scoring = current.scoring_settings || {};
  for (const lg of chain) {
    const season = lg.season;
    let done = LAST_WEEK;
    if (String(season) === String(state.season)) {
      done = state.season_type === 'regular' ? Math.max(0, state.week - 1)
        : state.season_type === 'post' ? LAST_WEEK : 0;
    }
    const jobs = [];
    for (let w = 1; w <= done; w++) {
      const id = `${season}:${w}`;
      // Re-read the latest finished week once: stat corrections land midweek.
      if (cache.weeks[id] && !(w === done && String(season) === String(state.season))) continue;
      jobs.push(async () => {
        const [stats, proj] = await Promise.all([sl.getWeekStats(season, w), sl.getWeekProjections(season, w)]);
        const pts = {};
        for (const pid in cache.players) {
          const s = stats[pid];
          if (!s) continue;
          const l = leaguePoints(s, scoring), r = pprPoints(s);
          // Didn't play (bye, injury, inactive): no line, so it isn't read as a dud.
          if (!s.gp && !l && !r) continue;
          const p = proj[pid];
          pts[pid] = [l, r, p ? leaguePoints(p, scoring) : null];
        }
        if (Object.keys(pts).length) cache.weeks[id] = { end: sl.weekEnd(season, w), label: `${season} wk ${w}`, pts };
      });
    }
    if (jobs.length) {
      progress(`Scoring ${jobs.length} week${jobs.length > 1 ? 's' : ''} of ${season} under league rules…`);
      await pool(jobs, 4);
    }
  }

  cache.syncedAt = Date.now();
  if (!saveCache()) {
    // Out of space: older seasons' weekly points are the cheapest thing to drop.
    const keep = String(current.season);
    for (const k of Object.keys(cache.weeks)) if (!k.startsWith(keep)) delete cache.weeks[k];
    saveCache();
  }
  progress('');
  return current;
}
