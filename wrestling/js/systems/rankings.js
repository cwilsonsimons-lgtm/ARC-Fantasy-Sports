// Rankings.
//
// A ranking has to be something a wrestler can argue with. "I have won six in a
// row and he is ranked above me" only works if the number came from results the
// wrestler can point at, so this is computed from the match record and nothing
// else - no hidden star rating, no booking committee thumb on the scale.
//
// Recomputed after every result. Fourteen wrestlers is nothing to sort, and
// recomputing beats maintaining, because an incrementally-updated ranking is
// one bug away from disagreeing with the record it claims to summarise.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { CAREER_RANK } from '../models/wrestler.js';
import { championIds } from '../models/title.js';

/** How far back results count. Roughly four months of weekly television. */
export const RANKING_WINDOW_DAYS = 120;

/** A result this old still counts for this much. */
const OLDEST_WEIGHT = 0.25;

const POINTS = Object.freeze({
  WIN: 12,
  DRAW: 3,
  LOSS: -8,
  /** Losing to someone well below your station costs extra, per tier of gap. */
  LOSS_TIER_PENALTY: 3,
  /** A title match counts for more than a television match. */
  TITLE_MULTIPLIER: 1.5,
  /** Lifetime record, as a steadying baseline under recent form. */
  CAREER_DIFFERENTIAL: 0.6,
  MOMENTUM: 0.10,
  STREAK_WIN: 2.0,
  STREAK_LOSS: -1.5,
  STREAK_CAP: 6,
});

/** How much a win over this opponent is worth, by their standing. */
function opponentWeight(opponentIds) {
  const tier = Math.max(0, ...opponentIds.map((id) => CAREER_RANK[store.getWrestler(id)?.standing.careerStatus] ?? 3));
  return 0.6 + tier * 0.2; // rookie 0.6 .. main event 1.4
}

/**
 * Score one wrestler, and show the working.
 * Pure with respect to the store: it reads, it never writes.
 */
export function scoreFor(wrestlerId, { today = store.today() } = {}) {
  const w = store.requireWrestler(wrestlerId);
  const parts = { career: 0, recent: 0, momentum: 0, streak: 0 };
  const results = [];

  parts.career = (w.standing.wins - w.standing.losses) * POINTS.CAREER_DIFFERENTIAL;

  const matches = store.queryLog({
    type: EVENT_TYPES.MATCH_RESULT,
    subjectId: wrestlerId,
    since: today - RANKING_WINDOW_DAYS,
  });

  for (const event of matches) {
    const { winnerIds = [], loserIds = [], participantIds = [], titleId } = event.data;
    const involved = participantIds.length ? participantIds : [...winnerIds, ...loserIds];
    if (!involved.includes(wrestlerId)) continue;

    const won = winnerIds.includes(wrestlerId);
    const lost = loserIds.includes(wrestlerId);
    const opponents = involved.filter((id) => id !== wrestlerId);

    let base = won ? POINTS.WIN : lost ? POINTS.LOSS : POINTS.DRAW;
    if (lost) {
      const mine = CAREER_RANK[w.standing.careerStatus] ?? 3;
      const theirs = Math.max(0, ...opponents.map((id) => CAREER_RANK[store.getWrestler(id)?.standing.careerStatus] ?? 3));
      base -= Math.max(0, mine - theirs) * POINTS.LOSS_TIER_PENALTY;
    }

    const age = Math.max(0, today - event.day);
    const recency = Math.max(OLDEST_WEIGHT, 1 - age / RANKING_WINDOW_DAYS);
    const value = base * opponentWeight(opponents) * recency * (titleId ? POINTS.TITLE_MULTIPLIER : 1);

    parts.recent += value;
    results.push({
      day: event.day, won, lost, titleId, opponents, value: Math.round(value * 10) / 10,
    });
  }

  parts.momentum = w.state.momentum * POINTS.MOMENTUM;

  const { type, count } = w.standing.streak;
  const capped = Math.min(count || 0, POINTS.STREAK_CAP);
  if (type === 'W') parts.streak = capped * POINTS.STREAK_WIN;
  else if (type === 'L') parts.streak = capped * POINTS.STREAK_LOSS;

  const points = parts.career + parts.recent + parts.momentum + parts.streak;
  return { wrestlerId, points, parts, results };
}

/** The whole roster, best first. Champions are ranked like everyone else. */
export function computeRankings({ today = store.today() } = {}) {
  return store.allWrestlers()
    .map((w) => scoreFor(w.id, { today }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const wa = store.getWrestler(a.wrestlerId);
      const wb = store.getWrestler(b.wrestlerId);
      if (wb.standing.wins !== wa.standing.wins) return wb.standing.wins - wa.standing.wins;
      return wb.ability.starPower - wa.ability.starPower;
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/** Recompute and write ranks back onto the roster. Emits one summary event. */
export function refresh({ cause = null } = {}) {
  const table = computeRankings();
  const movements = [];

  for (const entry of table) {
    const w = store.requireWrestler(entry.wrestlerId);
    const before = w.standing.rank;
    if (before !== entry.rank || Math.round(w.standing.rankPoints) !== Math.round(entry.points)) {
      // Silent: the ranking table moves as a whole, and one event per wrestler
      // would bury the log every time anybody wrestled.
      store.updateStanding(entry.wrestlerId, {
        rank: entry.rank,
        rankPoints: Math.round(entry.points * 10) / 10,
      }, { silent: true });
      if (before !== entry.rank) {
        movements.push({ id: entry.wrestlerId, from: before, to: entry.rank });
      }
    }
  }

  if (!movements.length) return null;

  const climbed = movements.filter((m) => m.from == null || m.to < m.from);
  const headline = climbed.sort((a, b) => a.to - b.to)[0] || movements[0];

  return store.emit(EVENT_TYPES.RANKING_UPDATED, {
    summary: `Rankings updated: ${store.nameOf(headline.id)} ${headline.from == null ? 'enters at' : 'moves to'} #${headline.to}`,
    subjects: movements.map((m) => m.id),
    cause,
    data: { movements },
  });
}

/** The ranked list as the GM sees it. */
export function table() {
  return store.allWrestlers()
    .filter((w) => w.standing.rank != null)
    .sort((a, b) => a.standing.rank - b.standing.rank);
}

/**
 * The highest-ranked wrestler who is not already holding this belt.
 * This is the #1 contender, and it is derived rather than declared, so it can
 * never disagree with the rankings the GM is looking at.
 */
export function contenderFor(titleId) {
  const title = store.requireTitle(titleId);
  const holders = new Set(championIds(title));
  return table().find((w) => !holders.has(w.id)) || null;
}

export function install() {
  const recompute = (event) => refresh({ cause: event.id });
  store.on(EVENT_TYPES.MATCH_RESULT, recompute);
  store.on(EVENT_TYPES.TITLE_WON, recompute);
}
