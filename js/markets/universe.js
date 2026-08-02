// Arc Markets — the tradeable universe.
//
// Tunable without touching logic. Everything below reads these values; nothing
// hardcodes 100, a position list or a contract length.
export const UNIVERSE = {
  SIZE: 100,                          // how many contracts are listed at all
  POSITIONS: ['QB', 'RB', 'WR', 'TE'],
  BLUE_CHIP_YEARS: 5,
  STANDARD_YEARS: 3,
  BLUE_CHIP_SIZE: 30,                 // top slice of SIZE that earns the longer contract
  RECOMPUTE: 'offseason',             // 'offseason' | 'never'
  SEASON: 2025,                       // the season being played
  PRIOR_SEASON: 2024,                 // the completed season eligibility is frozen from
};

import { NFL_BY_ID } from '../data/nfl-players.js';
import { histSeason } from '../data/nfl-history.js';

// ---------------------------------------------------------------- eligibility
//
// ELIGIBLE is the top SIZE fantasy scorers at skill positions from the prior
// completed season — real nflverse PPR totals, not projections. It is computed
// once, at load, and frozen: a player who breaks out in October does not become
// tradeable in October.
//
// Retired players are dropped. They finished top 100 and are still absent,
// which is the same rule as everyone else outside the universe — a contract
// that can never settle is not a contract.

function rankPriorSeason() {
  return histSeason(UNIVERSE.PRIOR_SEASON)
    .filter(r => UNIVERSE.POSITIONS.includes(r.pos))
    .filter(r => r.id && NFL_BY_ID[r.id])
    .sort((a, b) => b.ppr - a.ppr)
    .slice(0, UNIVERSE.SIZE);
}

const RANKED = rankPriorSeason();

/** id -> {rank, ppr, years, tier}. Membership and contract length in one place. */
export const ELIGIBLE = Object.fromEntries(RANKED.map((r, i) => {
  const blue = i < UNIVERSE.BLUE_CHIP_SIZE;
  return [r.id, {
    rank: i + 1,
    ppr: r.ppr,
    tier: blue ? 'blue' : 'standard',
    years: blue ? UNIVERSE.BLUE_CHIP_YEARS : UNIVERSE.STANDARD_YEARS,
  }];
}));

export const ELIGIBLE_IDS = RANKED.map(r => r.id);
export function isEligible(id) { return !!ELIGIBLE[id]; }
export function contractYears(id) { const e = ELIGIBLE[id]; return e ? e.years : 0; }
export function contractTier(id) { const e = ELIGIBLE[id]; return e ? e.tier : null; }
export function priorRank(id) { const e = ELIGIBLE[id]; return e ? e.rank : null; }

/** The last season a contract bought today can still be held through. */
export function heldThrough(id) {
  const y = contractYears(id);
  return y ? UNIVERSE.SEASON + y - 1 : UNIVERSE.SEASON;
}

/**
 * Eligibility recomputes in the offseason and never mid-season. A player who
 * finishes top 100 gains the longer contract for the *following* season.
 *
 * The prototype has one frozen season, so this is the gate rather than the
 * recomputation: it is what any future scheduler has to get past, and it
 * refuses in-season by design rather than by omission.
 */
export function canRecompute(phase) {
  return UNIVERSE.RECOMPUTE === 'offseason' && phase === 'offseason';
}
