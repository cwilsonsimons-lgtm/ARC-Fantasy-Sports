#!/usr/bin/env node
// Build records/data.js — the City Boys Dynasty Record Book — from the Sleeper API.
//
//   node tools/sleeper-records.mjs [leagueId] [--cache <dir>]
//
// Walks previous_league_id back to the league's first season, pulls every week's
// matchups, and computes the records the page shows. Everything is derived from
// Sleeper's own scores (starters_points / players_points), so the numbers match
// what the app shows.
//
// What counts as a game:
//   * Regular season (weeks before playoff_week_start): the head-to-head game, plus
//     — because the league plays the median (league_average_match) — a second
//     result against the week's median score. Both count toward win-loss records.
//   * Playoff weeks: only teams in a bracket game that week. Winners bracket games
//     are "Playoffs" (the 1st-place game is the "Championship"); losers bracket
//     games are "Consolation". A team on a bye or already out does not count,
//     so meaningless week-17 lineups never set a record.
//
// --cache <dir> keeps raw API responses on disk (handy while iterating; the player
// database alone is ~14 MB). Without it, everything is fetched fresh.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.sleeper.app/v1';
const DEFAULT_LEAGUE = '1312045587541020672'; // City Boys Dynasty, 2026

const args = process.argv.slice(2);
const cacheAt = args.indexOf('--cache');
const CACHE = cacheAt >= 0 ? args.splice(cacheAt, 2)[1] : null;
const LEAGUE = args[0] || DEFAULT_LEAGUE;
if (CACHE) fs.mkdirSync(CACHE, { recursive: true });

async function get(p) {
  const file = CACHE && path.join(CACHE, p.replace(/^\//, '').replace(/\//g, '_') + '.json');
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + p);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      if (file) fs.writeFileSync(file, text);
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= 4) throw new Error(`GET ${p}: ${e.message}`);
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

const r2 = n => Math.round(n * 100) / 100;
const by = (k, dir = -1) => (a, b) => dir * (a[k] - b[k]);

// ---------- fetch ----------
const nfl = await get('/state/nfl');
const seasons = [];
for (let id = LEAGUE; id && id !== '0';) {
  const league = await get(`/league/${id}`);
  const [users, rosters, wb, lb] = await Promise.all([
    get(`/league/${id}/users`), get(`/league/${id}/rosters`),
    get(`/league/${id}/winners_bracket`), get(`/league/${id}/losers_bracket`),
  ]);
  const s = league.settings;
  const lastWeek = league.status === 'complete'
    ? (s.last_scored_leg || 17)
    : Math.min(s.last_scored_leg || 0, nfl.season === league.season ? nfl.week - 1 : 18);
  const weeks = [];
  for (let w = 1; w <= lastWeek; w++) weeks.push({ week: w, rows: await get(`/league/${id}/matchups/${w}`) });
  seasons.push({ league, users, rosters, wb: wb || [], lb: lb || [], weeks, lastWeek });
  id = league.previous_league_id;
}
seasons.reverse(); // oldest first
const playersDb = await get('/players/nfl');

// ---------- owners ----------
// Owners are tracked by Sleeper user id, so a team renamed every season stays one owner.
const owners = {};
for (const S of seasons) {
  for (const u of S.users) {
    owners[u.user_id] = {
      id: u.user_id, name: u.display_name, avatar: u.avatar || null,
      team: (u.metadata && u.metadata.team_name) || u.display_name,
    }; // later seasons overwrite: the current name and team name win
  }
  S.rosterOwner = {}; S.teamName = {};
  const um = Object.fromEntries(S.users.map(u => [u.user_id, u]));
  for (const r of S.rosters) {
    S.rosterOwner[r.roster_id] = r.owner_id;
    const u = um[r.owner_id];
    S.teamName[r.roster_id] = (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || `Team ${r.roster_id}`;
  }
}

// ---------- players ----------
const used = new Set();
function player(id) {
  used.add(id);
  const p = playersDb[id] || {};
  const pos = p.position || (p.fantasy_positions || [])[0] || '';
  return {
    id, pos: pos === 'DEF' ? 'D/ST' : pos, nfl: p.team || (pos === 'DEF' ? id : null),
    name: pos === 'DEF' ? `${p.last_name || id} D/ST` : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id),
  };
}

// ---------- games ----------
const games = [];      // one row per team per counted week
const pairings = [];   // head-to-head games
const playerWeeks = []; // starter + bench rows
for (const S of seasons) {
  const season = +S.league.season;
  const pws = S.league.settings.playoff_week_start || 15;
  const median = !!S.league.settings.league_average_match;
  for (const { week, rows } of S.weeks) {
    const byRoster = Object.fromEntries(rows.map(r => [r.roster_id, r]));
    let pairs = []; // [rosterA, rosterB, kind]
    if (week < pws) {
      const m = {};
      for (const r of rows) if (r.matchup_id != null) (m[r.matchup_id] ||= []).push(r.roster_id);
      pairs = Object.values(m).filter(p => p.length === 2).map(p => [...p, 'Regular']);
    } else {
      const round = week - pws + 1;
      for (const [br, kind] of [[S.wb, 'Playoffs'], [S.lb, 'Consolation']]) {
        for (const g of br) {
          if (g.r !== round || g.t1 == null || g.t2 == null) continue;
          pairs.push([g.t1, g.t2, kind === 'Playoffs' && g.p === 1 ? 'Championship' : kind]);
        }
      }
    }
    // A week with no points at all has not been played yet.
    if (!pairs.some(([a, b]) => (byRoster[a]?.points || 0) + (byRoster[b]?.points || 0) > 0)) continue;

    const scores = pairs.flatMap(([a, b]) => [byRoster[a]?.points || 0, byRoster[b]?.points || 0]).sort((x, y) => x - y);
    const med = week < pws && median ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2 : null;

    for (const [a, b, kind] of pairs) {
      const A = byRoster[a], B = byRoster[b];
      if (!A || !B) continue;
      pairings.push({ season, week, kind, a: rowRef(S, A), b: rowRef(S, B) });
      for (const [me, opp] of [[A, B], [B, A]]) {
        games.push({
          season, week, kind, owner: S.rosterOwner[me.roster_id], team: S.teamName[me.roster_id],
          pts: r2(me.points), opp: r2(opp.points), oppOwner: S.rosterOwner[opp.roster_id],
          vsMedian: med == null ? null : (me.points > med ? 1 : me.points < med ? -1 : 0),
        });
        const starters = new Set(me.starters);
        me.starters.forEach((pid, i) => {
          if (!pid || pid === '0') return;
          playerWeeks.push({ season, week, kind, owner: S.rosterOwner[me.roster_id], team: S.teamName[me.roster_id],
            pid, pts: r2(me.starters_points[i] || 0), started: true });
        });
        for (const pid of me.players || []) {
          if (starters.has(pid)) continue;
          const pts = (me.players_points || {})[pid];
          if (pts) playerWeeks.push({ season, week, kind, owner: S.rosterOwner[me.roster_id], team: S.teamName[me.roster_id], pid, pts: r2(pts), started: false });
        }
      }
    }
  }
}
function rowRef(S, r) { return { owner: S.rosterOwner[r.roster_id], team: S.teamName[r.roster_id], pts: r2(r.points) }; }

// ---------- records ----------
const first = seasons[0].league.season;
const cur = seasons[seasons.length - 1];
const curSeason = +cur.league.season;
const started = playerWeeks.filter(p => p.started);
const curWeeks = games.filter(g => g.season === curSeason).map(g => g.week);
const latestWeek = curWeeks.length ? Math.max(...curWeeks) : null;

const pw = p => ({ ...player(p.pid), owner: p.owner, team: p.team, season: p.season, week: p.week, kind: p.kind, pts: p.pts });
const gm = g => ({ owner: g.owner, team: g.team, season: g.season, week: g.week, kind: g.kind, pts: g.pts, opp: g.opp, oppOwner: g.oppOwner });

// Sum a player's starts, crediting the team they started for most often.
function totals(rows) {
  const t = {};
  for (const p of rows) {
    const x = (t[p.pid] ||= { pid: p.pid, pts: 0, starts: 0, teams: {} });
    x.pts += p.pts; x.starts++;
    const k = p.owner + '|' + p.team; x.teams[k] = (x.teams[k] || 0) + 1;
  }
  return Object.values(t).map(x => {
    const [owner, team] = Object.entries(x.teams).sort((a, b) => b[1] - a[1])[0][0].split('|');
    return { ...player(x.pid), owner, team, pts: r2(x.pts), starts: x.starts };
  }).sort(by('pts'));
}
// Ties share a rank: 1, 1, 3.
const ranked = (list, k = 'pts') => list.map((x, i) => ({ ...x, rank: list.findIndex(y => y[k] === x[k]) + 1 }));
const top = (list, n, k) => ranked(list.slice(0, n), k);

const best = [...started].sort(by('pts'));
const hiScore = best.filter(p => p.pts === best[0].pts).map(pw);

const POSITIONS = [...new Set(cur.league.roster_positions)]
  .filter(p => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p)).map(p => p === 'DEF' ? 'D/ST' : p);
const curTotals = totals(started.filter(p => p.season === curSeason));

const positionKings = seasons.filter(S => S !== cur || S.league.status === 'complete').map(S => {
  const t = totals(started.filter(p => p.season === +S.league.season));
  return { season: +S.league.season, kings: Object.fromEntries(POSITIONS.map(pos => [pos, t.find(x => x.pos === pos) || null])) };
}).reverse();

// Champions & finishes.
const champions = seasons.map(S => {
  const final = S.wb.find(g => g.p === 1);
  const third = S.wb.find(g => g.p === 3);
  if (!final || final.w == null) return { season: +S.league.season, done: false };
  const o = r => r == null ? null : { owner: S.rosterOwner[r], team: S.teamName[r] };
  return { season: +S.league.season, done: true, champ: o(final.w), runnerUp: o(final.l), third: o(third && third.w) };
}).reverse();

// All-time owner table.
const table = {};
for (const g of games) {
  const t = (table[g.owner] ||= { owner: g.owner, w: 0, l: 0, t: 0, mw: 0, ml: 0, pf: 0, pa: 0, games: 0, titles: 0, playoffs: 0, playoffW: 0, playoffL: 0, seasons: new Set() });
  t.seasons.add(g.season);
  const res = g.pts > g.opp ? 'w' : g.pts < g.opp ? 'l' : 't';
  if (g.kind === 'Regular') {
    t[res]++; t.pf += g.pts; t.pa += g.opp; t.games++;
    if (g.vsMedian === 1) t.mw++; else if (g.vsMedian === -1) t.ml++;
  } else if (g.kind !== 'Consolation') {
    if (res === 'w') t.playoffW++; else if (res === 'l') t.playoffL++;
  }
}
for (const S of seasons) {
  const seen = new Set();
  for (const g of S.wb) for (const r of [g.t1, g.t2]) if (r != null) seen.add(S.rosterOwner[r]);
  for (const o of seen) if (table[o]) table[o].playoffs++;
}
for (const c of champions) if (c.done && table[c.champ.owner]) table[c.champ.owner].titles++;
const standings = Object.values(table).map(t => ({
  owner: t.owner, w: t.w + t.mw, l: t.l + t.ml, t: t.t, h2h: [t.w, t.l], median: [t.mw, t.ml],
  pct: r2((t.w + t.mw) / Math.max(1, t.w + t.mw + t.l + t.ml + t.t) * 1000) / 1000,
  pf: r2(t.pf), ppg: r2(t.pf / Math.max(1, t.games)), titles: t.titles, playoffs: t.playoffs,
  playoffRecord: [t.playoffW, t.playoffL], seasons: t.seasons.size,
})).sort((a, b) => b.titles - a.titles || b.pct - a.pct || b.pf - a.pf);

const games2 = games.filter(g => g.pts > 0);
const margins = pairings.filter(p => p.a.pts + p.b.pts > 0).map(p => {
  const [w, l] = p.a.pts >= p.b.pts ? [p.a, p.b] : [p.b, p.a];
  return { season: p.season, week: p.week, kind: p.kind, winner: w, loser: l, margin: r2(w.pts - l.pts) };
});

const data = {
  league: { id: LEAGUE, name: cur.league.name, avatar: cur.league.avatar || null, since: +first, season: curSeason,
    latestWeek, median:!!cur.league.settings.league_average_match },
  updated: new Date().toISOString(),
  positions: POSITIONS,
  owners,
  champions,
  standings,
  hiScore,
  topScorers: latestWeek ? top([...started].filter(p => p.season === curSeason && p.week === latestWeek).sort(by('pts')).map(pw), 5) : [],
  seasonLeaders: top(curTotals, 5),
  bestByPosition: Object.fromEntries(POSITIONS.map(pos => [pos, top(curTotals.filter(x => x.pos === pos), 3)])),
  positionKings,
  biggestGames: top([...games2].sort(by('pts')).map(gm), 10),
  biggestWeeks: top(best.map(pw), 10),
  mostPoints: top(totals(started), 10),
  bench: top([...playerWeeks].filter(p => !p.started).sort(by('pts')).map(pw), 5),
  blowouts: top([...margins].sort(by('margin')), 5, 'margin'),
  closest: top([...margins].filter(m => m.margin > 0).sort(by('margin', 1)), 5, 'margin'),
  heartbreak: top([...games2].filter(g => g.pts < g.opp).sort(by('pts')).map(gm), 5),
  smallestGames: top([...games2].sort(by('pts', 1)).map(gm), 5),
  worstStarts: top([...started].sort(by('pts', 1)).map(pw), 5),
};

const out = path.join(ROOT, 'records', 'data.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// Generated by tools/sleeper-records.mjs — do not edit by hand.\n// Refresh: npm run records\nwindow.RECORDS = ${JSON.stringify(data)};\n`);
console.log(`Wrote ${path.relative(ROOT, out)}: ${seasons.length} seasons (${first}–${curSeason}), ` +
  `${games.length / 2 | 0} games, ${started.length} starts, latest week ${latestWeek}.`);
