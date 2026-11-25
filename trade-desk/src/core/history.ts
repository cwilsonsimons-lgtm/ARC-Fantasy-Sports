// Values over time. Every sync writes a dated snapshot of the market and of every team's view,
// so a player's line shows how his value moved and which teams moved with it.
import type { Player, Snapshot } from './types';
import { MARKET_RECENCY, modelPlayerValue } from './model';
import type { Valuer } from './model';

export const dayOf = (iso: string) => iso.slice(0, 10);

export function takeSnapshot(v: Valuer, ts: string): Snapshot {
  const ids = Object.keys(v.league.owner);
  const market: Record<string, number> = {};
  for (const id of ids) market[id] = v.market(id);
  const teams: Record<string, Record<string, number>> = {};
  for (const t of v.league.teams) {
    const row: Record<string, number> = {};
    for (const id of ids) row[id] = v.value(t.id, id);
    teams[t.id] = row;
  }
  return { date: dayOf(ts), ts, market, teams };
}

export interface Point {
  date: string;
  value: number;
  /** true when the point was rebuilt from game logs rather than recorded at the time */
  rebuilt?: boolean;
}

/** One asset's line through a list of snapshots, oldest first. */
export function series(snaps: Snapshot[], id: string, team?: string): Point[] {
  return [...snaps]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, value: team ? s.teams[team]?.[id] : s.market[id] }))
    .filter((p): p is Point => typeof p.value === 'number');
}

export interface GameLine {
  week: number;
  date: string;
  points: number;
}

/** Pull game lines out of a get_player_stats (timeframe "recent") payload. */
export function gameLines(payload: unknown): GameLine[] {
  const d = ((payload as any)?.data ?? payload) as any;
  return ((d?.games ?? []) as any[])
    .filter((g) => typeof g.fantasy_points === 'number')
    .map((g) => ({ week: g.week, date: g.date, points: g.fantasy_points }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rebuild a player's market line week by week from his game log: at each week, the same
 * half-life-weighted form the live numbers use and the plain average so far, priced with the
 * market's blend. It shows how a hot streak moved his value before the desk was recording.
 */
export function rebuildFromGames(p: Player, games: GameLine[], halfLife = 3.4): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < games.length; i++) {
    const upto = games.slice(0, i + 1);
    let wsum = 0;
    let fsum = 0;
    upto.forEach((g, j) => {
      const w = Math.pow(0.5, (upto.length - 1 - j) / halfLife);
      wsum += w;
      fsum += w * g.points;
    });
    const form = fsum / wsum;
    const avg = upto.reduce((s, g) => s + g.points, 0) / upto.length;
    // Early in the log the sample is thin; lean on today's longer-run read until it fills in.
    const k = Math.min(1, upto.length / 6);
    const base = k * avg + (1 - k) * p.base;
    const value = modelPlayerValue({ ...p, form, base }, MARKET_RECENCY);
    out.push({ date: games[i].date, value, rebuilt: true });
  }
  return out;
}
