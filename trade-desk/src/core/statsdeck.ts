// Turns StatsDeck connector payloads (Sleeper league data) into a League.
// Shapes observed from get_standings, get_my_roster, get_league_team and get_trades.
import type { League, Pick, Player, Pos, Slot, Team, TradeLog } from './types';
import { POSITIONS } from './types';

type Json = Record<string, any>;

/** Payloads arrive as `{success, data}`; tolerate the bare `data` too. */
export const dataOf = (payload: unknown): Json => {
  const p = payload as Json;
  return (p && typeof p === 'object' && 'data' in p ? p.data : p) ?? {};
};

const parseRecord = (r: string | undefined) => {
  const m = /^(\d+)-(\d+)/.exec(r ?? '');
  return m ? { wins: +m[1], losses: +m[2] } : { wins: 0, losses: 0 };
};
const parseStanding = (s: string | undefined) => {
  const m = /^(\d+)/.exec(s ?? '');
  return m ? +m[1] : 0;
};

export function teamsFromStandings(standings: unknown, myTeamName: string): Team[] {
  const d = dataOf(standings);
  const ids = new Map<string, string>();
  for (const t of d.strength?.teams ?? []) ids.set(t.team_name, String(t.team_id));
  return (d.standings ?? []).map((row: Json): Team => ({
    id: ids.get(row.team_name) ?? row.team_name,
    name: row.team_name,
    ...parseRecord(row.record_display),
    standing: parseStanding(row.standing),
    ...(row.team_name === myTeamName ? { me: true } : {}),
  }));
}

const SECTIONS: [string, Slot][] = [
  ['starters', 'start'],
  ['bench', 'bench'],
  ['taxi', 'taxi'],
  ['reserve', 'ir'],
];

const round1 = (x: number) => Math.round(x * 100) / 100;

export function playerFromRow(row: Json, slot: Slot = 'bench'): Player | null {
  const pos = row.position as Pos;
  if (!POSITIONS.includes(pos) || !row.source_id) return null;
  const rookieProj = row.rookie_projection?.projected_ppg;
  const games = row._form?.weighting_basis?.games ?? 0;
  let form: number = row._form?.form_score ?? rookieProj ?? row.fantasy_points_per_game ?? 0;
  // A rookie with a handful of games: lean on the projection until the sample says otherwise.
  if (rookieProj != null && games < 4) form = (form * games + rookieProj * (4 - games)) / 4;
  const delta = row._trajectory?.delta;
  const trend = typeof delta === 'number' && delta > -0.9 ? delta : 0;
  const base = form / (1 + trend);
  return {
    id: 'p:' + row.source_id,
    name: row.name,
    pos,
    age: row.age ?? 25,
    nfl: row.nfl_team ?? '',
    rookie: !!row.is_rookie,
    form: round1(form),
    base: round1(base),
    trend: round1(trend),
    slot,
    ...(row.platform_injury ? { inj: row.platform_injury } : {}),
    ...(row.rookie_projection?.overall_pick ? { ovr: row.rookie_projection.overall_pick } : {}),
  };
}

export interface RosterRead {
  teamId: string;
  players: Player[];
  picks: Pick[];
}

export function rosterFromTeam(payload: unknown, teams: Team[]): RosterRead {
  const d = dataOf(payload);
  const byName = new Map(teams.map((t) => [t.name, t.id]));
  const teamId = d.team_id != null ? String(d.team_id) : byName.get(d.team_name) ?? d.team_name;
  const players: Player[] = [];
  for (const [key, slot] of SECTIONS) {
    for (const row of d[key] ?? []) {
      const p = playerFromRow(row, slot);
      if (p) players.push(p);
    }
  }
  const picks: Pick[] = (d.owned_picks ?? []).map((k: Json) => {
    const orig = byName.get(k.original_owner) ?? k.original_owner;
    return { id: `k:${k.season}-${k.round}-${orig}`, season: +k.season, round: +k.round, orig };
  });
  return { teamId, players, picks };
}

export function buildLeague(standings: unknown, rosters: unknown[], myTeamName: string, asOf: string): League {
  const teams = teamsFromStandings(standings, myTeamName);
  const league: League = {
    name: dataOf(standings).connection?.league_name ?? 'League',
    asOf,
    season: 0,
    teams,
    players: {},
    picks: {},
    owner: {},
  };
  let minSeason = Infinity;
  for (const r of rosters) {
    const read = rosterFromTeam(r, teams);
    for (const p of read.players) {
      league.players[p.id] = p;
      league.owner[p.id] = read.teamId;
    }
    for (const k of read.picks) {
      league.picks[k.id] = k;
      league.owner[k.id] = read.teamId;
      minSeason = Math.min(minSeason, k.season);
    }
  }
  league.season = Number.isFinite(minSeason) ? minSeason : new Date(asOf).getFullYear() + 1;
  // The week every player's projection is for is the week coming up.
  const weeks = new Map<number, number>();
  for (const r of rosters) {
    const d = dataOf(r);
    for (const [key] of SECTIONS) for (const row of d[key] ?? []) {
      const w = row.weekly_projection?.week;
      if (typeof w === 'number') weeks.set(w, (weeks.get(w) ?? 0) + 1);
    }
  }
  const top = [...weeks.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) league.week = top[0];
  return league;
}

/**
 * Completed league trades become log entries (both sides accepted), and their players are
 * added to the league's player table so a player who has since been cut still has a value.
 */
export function tradesFromPayload(payload: unknown, league: League): TradeLog[] {
  const d = dataOf(payload);
  const byName = new Map(league.teams.map((t) => [t.name, t.id]));
  const out: TradeLog[] = [];
  for (const t of d.recent_trades ?? []) {
    if (t.status !== 'completed' || (t.sides ?? []).length !== 2) continue;
    const [a, b] = t.sides as Json[];
    const recv = (s: Json) => {
      const ids: string[] = [];
      for (const row of s.receives_players ?? []) {
        const p = playerFromRow(row);
        if (!p) continue;
        if (!league.players[p.id]) league.players[p.id] = p;
        ids.push(p.id);
      }
      for (const k of s.receives_picks ?? []) {
        const orig = byName.get(k.original_owner) ?? String(k.original_owner);
        const id = `k:${k.season}-${k.round}-${orig}`;
        if (!league.picks[id]) league.picks[id] = { id, season: +k.season, round: +k.round, orig };
        ids.push(id);
      }
      return ids;
    };
    const aGets = recv(a);
    const bGets = recv(b);
    const teamA = String(a.team_id ?? byName.get(a.team_name));
    const teamB = String(b.team_id ?? byName.get(b.team_name));
    out.push({
      id: 'sleeper-' + t.trade_id,
      ts: new Date(t.proposed_at ?? Date.now()).toISOString(),
      team: teamA,
      with: teamB,
      give: bGets,
      get: aGets,
      outcome: 'completed',
      source: 'sleeper',
    });
  }
  return out;
}
