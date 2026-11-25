// Editing a ranking: moving an asset to a rank means giving it a value between its new neighbours.
// And keeping a ranking per week: each week's record, and which one is in force now.
import type { RankingWeek, Settings } from './types';
import type { Valuer } from './model';
import { assetName, groupOf } from './model';

export interface Ranked {
  id: string;
  value: number;
  name: string;
}

export const MAX_VALUE = 10000;
export const clampValue = (v: number) => Math.round(Math.min(MAX_VALUE, Math.max(0, v)));

/** Highest value first; ties broken by name so the order never jumps around. */
export const byValue = (a: Ranked, b: Ranked) => b.value - a.value || a.name.localeCompare(b.name);

/**
 * The value that puts `id` at `rank` (1 = top) in `list`, given everyone else keeps theirs.
 * Halfway between the two neighbours; past either end, a step beyond the last one.
 */
export function valueForRank(list: Ranked[], id: string, rank: number): number {
  const others = list.filter((r) => r.id !== id).sort(byValue);
  const i = Math.max(0, Math.min(others.length, Math.round(rank) - 1));
  const above = others[i - 1];
  const below = others[i];
  if (!above && !below) return list.find((r) => r.id === id)?.value ?? 0;
  if (!above) return clampValue(Math.max(below.value + 50, below.value));
  if (!below) return clampValue(above.value - 50);
  return clampValue((above.value + below.value) / 2);
}

export interface Edited {
  mine: Record<string, number>;
  consensus: Record<string, number>;
}

/**
 * The rankings in force for `week`: that week's own record, else the latest earlier one
 * (a new week starts from last week's list), else whatever was set before weeks existed.
 */
export function editsFor(weeks: RankingWeek[], week: string, settings: Settings): { edited: Edited; from: RankingWeek | null } {
  const own = weeks.find((w) => w.week === week);
  if (own) return { edited: own.edited, from: own };
  const prev = weeks.filter((w) => w.week < week).sort((a, b) => b.week.localeCompare(a.week))[0];
  if (prev) return { edited: prev.edited, from: prev };
  return { edited: { mine: settings.mine ?? {}, consensus: settings.consensus ?? {} }, from: null };
}

/** Freeze the whole board as `v` sees it now. */
export function freezeWeek(v: Valuer, week: string, label: string, edited: Edited, at: string): RankingWeek {
  const board: RankingWeek['board'] = { mine: {}, league: {} };
  const names: RankingWeek['names'] = {};
  for (const id of Object.keys(v.league.owner)) {
    board.mine[id] = v.value(v.me, id);
    board.league[id] = v.market(id);
    const p = v.league.players[id];
    const k = v.league.picks[id];
    const orig = k && v.league.teams.find((t) => t.id === k.orig)?.name;
    names[id] = [p ? p.name : assetName(v.league, id) + (orig ? ` (${orig})` : ''), groupOf(v.league, id)];
  }
  return { week, label, updatedAt: at, edited, board, names };
}
