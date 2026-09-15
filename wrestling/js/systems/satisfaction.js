// How a wrestler reads their own situation.
//
// Morale used to be a number that events nudged. That is backwards: a wrestler
// is not unhappy because something bad happened three weeks ago, they are
// unhappy because of where they stand TODAY. This works out where they stand,
// across six things they are separately judging the GM on, and morale settles
// toward the answer over time (upkeep.js does the settling).
//
// Everything here is pure: it reads the world and returns numbers with reasons.
// It is also the input to requests.js, which is why nothing in here is random.
// A wrestler asking for something has to be able to say why.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import {
  statusRank, standingWeight, alliesOf, enemiesOf, memoryWeightOn, CAREER_RANK,
} from '../models/wrestler.js';
import { expectedMinutes, expectedSlot } from './disposition.js';
import { championIds, isVacant } from '../models/title.js';
import { MEMORY_TYPES } from '../models/memory.js';

/** How far back "lately" reaches, in completed shows. Roughly a month. */
export const RECENT_SHOWS = 4;

export const DIMENSIONS = Object.freeze([
  'booking', 'tvTime', 'role', 'championship', 'contract', 'standing',
]);

export const DIMENSION_LABEL = Object.freeze({
  booking: 'How they are booked',
  tvTime: 'Television time',
  role: 'Their spot on the card',
  championship: 'Championship prospects',
  contract: 'What they are paid',
  standing: 'Standing with you and the room',
});

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Completed shows, newest first. */
export function recentShows(n = RECENT_SHOWS) {
  return store.allShows()
    .filter((s) => s.status === 'complete')
    .sort((a, b) => b.day - a.day)
    .slice(0, n);
}

/** Every segment this wrestler worked on those shows, with where it sat. */
export function appearances(wrestlerId, shows = recentShows()) {
  const out = [];
  for (const show of shows) {
    const ids = show.segmentIds;
    ids.forEach((segId, index) => {
      const seg = store.getSegment(segId);
      if (!seg || !seg.participants.some((p) => p.wrestlerId === wrestlerId)) return;
      out.push({
        show, segment: seg, index, total: ids.length,
        slot: ids.length > 1 ? index / (ids.length - 1) : 1,
        seconds: seg.result.actualSec || 0,
      });
    });
  }
  return out;
}

/** How often someone of this standing expects to be on television. */
export function expectedAppearanceRate(w) {
  return 0.4 + standingWeight(w) * 0.6;   // rookie 0.4 of shows, superstar all of them
}

// ---------------------------------------------------------------------------
// Championship ambition
// ---------------------------------------------------------------------------

/**
 * Which belt they believe is theirs to chase, and how badly they want it now.
 *
 * Plausibility matters: a jobber does not lie awake about the World title, and
 * a superstar does not want the secondary one. Urgency comes from ambition,
 * from how close the rankings say they are, and from how long it has been since
 * anyone gave them a look.
 */
export function championshipAmbition(wrestlerId) {
  const w = store.requireWrestler(wrestlerId);
  const titles = store.allTitles();
  if (!titles.length) return null;

  const held = store.titlesHeldBy(wrestlerId);
  const rank = statusRank(w);

  // Top of the card chases the top belt; the middle chases the middle one.
  const world = titles.find((t) => t.tier === 'world');
  const secondary = titles.find((t) => t.tier !== 'world') || world;
  const wanted = rank >= CAREER_RANK.upper_midcard ? world : secondary;
  if (!wanted) return null;

  // Already holding it: the ambition is to keep it.
  if (held.some((t) => t.id === wanted.id)) {
    return { titleId: wanted.id, urgency: 0, holding: true, reasons: ['Already holds it'] };
  }

  const reasons = [];
  let urgency = w.identity.ambition * 0.45;
  reasons.push(`Ambition ${w.identity.ambition}`);

  const standing = w.standing.rank;
  if (standing != null) {
    const proximity = Math.max(0, 1 - (standing - 1) / 8);   // #1 = 1.0, #9+ = 0
    urgency += proximity * 30;
    if (proximity > 0.5) reasons.push(`Ranked #${standing}`);
  }

  if (wanted.contenderId === wrestlerId) {
    urgency += 15;
    reasons.push(`Is the #1 contender for the ${wanted.shortName} title`);
  }
  if (isVacant(wanted)) {
    urgency += 10;
    reasons.push('The title is vacant');
  }

  // Being passed over is the thing that turns wanting into demanding.
  const today = store.today();
  const denied = w.memory
    .filter((m) => m.type === MEMORY_TYPES.TITLE_SHOT_DENIED.key)
    .reduce((t, m) => t + memoryWeightOn(m, today), 0);
  if (denied > 0) {
    urgency += Math.min(25, denied * 0.3);
    reasons.push('Has been passed over before');
  }

  // A recent shot takes the edge off.
  const lastShot = w.memory
    .filter((m) => m.type === MEMORY_TYPES.TITLE_SHOT.key)
    .sort((a, b) => b.day - a.day)[0];
  if (lastShot && today - lastShot.day < 60) {
    urgency -= 25;
    reasons.push('Had a shot recently');
  }

  return { titleId: wanted.id, urgency: clamp(urgency), holding: false, reasons };
}

// ---------------------------------------------------------------------------
// The six dimensions
// ---------------------------------------------------------------------------

function bookingSatisfaction(w, apps, shows) {
  const reasons = [];
  if (!shows.length) return { score: 50, reasons: ['No shows have run yet'] };

  const expected = Math.max(0.5, shows.length * expectedAppearanceRate(w));
  const ratio = apps.length / expected;
  let score = 50 + (ratio - 1) * 40;
  reasons.push(`On ${apps.length} of the last ${shows.length} shows, expects about ${Math.round(expected)}`);

  const matches = apps.filter((a) => a.segment.kind === 'match');
  if (matches.length) {
    const wins = matches.filter((a) => (a.segment.result.winnerIds || []).includes(w.id)).length;
    const winRate = wins / matches.length;
    const expectedRate = 0.3 + standingWeight(w) * 0.45;   // jobber loses, superstar wins
    score += (winRate - expectedRate) * 45;
    reasons.push(`Winning ${Math.round(winRate * 100)}% lately, expects about ${Math.round(expectedRate * 100)}%`);
  }
  return { score: clamp(score), reasons };
}

function tvTimeSatisfaction(w, apps, shows) {
  const reasons = [];
  if (!shows.length) return { score: 50, reasons: ['No shows have run yet'] };

  const got = apps.reduce((t, a) => t + a.seconds, 0);
  const wantPerShow = expectedMinutes(w) * 60 * expectedAppearanceRate(w);
  const want = Math.max(60, wantPerShow * shows.length);
  const ratio = got / want;
  reasons.push(`${Math.round(got / 60)} minutes of television lately, expects about ${Math.round(want / 60)}`);
  return { score: clamp(50 + (ratio - 1) * 35), reasons };
}

function roleSatisfaction(w, apps) {
  const reasons = [];
  let score = 50;

  if (apps.length) {
    const avgSlot = apps.reduce((t, a) => t + a.slot, 0) / apps.length;
    const want = expectedSlot(w);
    score += (avgSlot - want) * 60;
    reasons.push(`Booked ${Math.round(avgSlot * 100)}% up the card, expects ${Math.round(want * 100)}%`);
  } else {
    reasons.push('Has not been on a card to judge');
  }

  // The rankings are the other half of "what am I here": a main-eventer sitting
  // eleventh knows something has gone wrong even if the card position is fine.
  if (w.standing.rank != null) {
    const roster = store.allWrestlers().length;
    const actual = 1 - (w.standing.rank - 1) / Math.max(1, roster - 1);
    const expected = expectedSlot(w);
    score += (actual - expected) * 35;
    reasons.push(`Ranked #${w.standing.rank} of ${roster} as a ${w.standing.careerStatus.replace('_', ' ')}`);
  }
  if (!reasons.length) reasons.push('Nothing to judge their spot against yet');
  return { score: clamp(score), reasons };
}

function championshipSatisfaction(w) {
  const want = championshipAmbition(w.id);
  if (!want) return { score: 50, reasons: ['No championships exist'] };
  if (want.holding) {
    return { score: 88, reasons: [`Holds the ${store.getTitle(want.titleId)?.shortName} title`] };
  }
  const title = store.getTitle(want.titleId);
  return {
    score: clamp(58 - want.urgency * 0.55),
    reasons: [`Wants the ${title?.shortName} title`, ...want.reasons],
  };
}

function contractSatisfaction(w) {
  const reasons = [];
  const peers = store.allWrestlers()
    .filter((x) => x.id !== w.id && x.standing.careerStatus === w.standing.careerStatus)
    .map((x) => x.contract.salary)
    .filter((n) => n > 0);

  const benchmark = peers.length ? median(peers) : median(store.allWrestlers().map((x) => x.contract.salary));
  if (!benchmark || !w.contract.salary) return { score: 50, reasons: ['No pay to compare'] };

  const ratio = w.contract.salary / benchmark;
  let score = 50 + (ratio - 1) * 45;
  reasons.push(peers.length
    ? `Paid ${Math.round(ratio * 100)}% of what others at their level get`
    : `Paid ${Math.round(ratio * 100)}% of the roster median`);

  // Somebody outgrowing their deal notices it every week.
  if (w.standing.rank != null && w.standing.rank <= 4 && ratio < 1.1) {
    score -= 12;
    reasons.push(`Ranked #${w.standing.rank} on a deal that has not moved`);
  }
  const expiry = w.contract.expiresOnDay;
  if (expiry != null) {
    const left = expiry - store.today();
    if (left < 120) {
      score -= (120 - Math.max(0, left)) * 0.08;
      reasons.push(`${Math.max(0, left)} days left on the deal`);
    }
  }
  return { score: clamp(score), reasons };
}

function standingSatisfaction(w) {
  const reasons = [];
  const gm = (w.ties.gm.trust + w.ties.gm.respect) / 2;
  let score = 50 + (gm - 50) * 0.7;
  reasons.push(`Trusts you ${w.ties.gm.trust}, rates you ${w.ties.gm.respect}`);

  const allies = alliesOf(w).length;
  const enemies = enemiesOf(w).length;
  score += (allies - enemies) * 4;
  if (allies || enemies) reasons.push(`${allies} allies, ${enemies} enemies in the room`);

  const today = store.today();
  const grievance = w.memory
    .filter((m) => [MEMORY_TYPES.CUT_FROM_SHOW.key, MEMORY_TYPES.OVERLOOKED.key,
      MEMORY_TYPES.PROMISE_BROKEN.key].includes(m.type))
    .reduce((t, m) => t + memoryWeightOn(m, today), 0);
  if (grievance > 0) {
    score -= Math.min(25, grievance * 0.12);
    reasons.push('Carrying grievances about how they have been used');
  }
  return { score: clamp(score), reasons };
}

/**
 * What each dimension is worth to THIS person. An ambitious wrestler weighs
 * championships heavily; a big ego weighs pay and position; somebody with
 * neither mostly wants to be booked.
 */
function weightsFor(w) {
  const ego = w.identity.ego / 100;
  const ambition = w.identity.ambition / 100;
  const raw = {
    booking: 0.25,
    tvTime: 0.12 + ambition * 0.08,
    role: 0.14 + ego * 0.12,
    championship: 0.08 + ambition * 0.16,
    contract: 0.06 + ego * 0.10,
    standing: 0.14,
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

/**
 * The whole picture for one wrestler. `overall` is what morale settles toward.
 */
export function satisfactionOf(wrestlerId, { showCount = RECENT_SHOWS } = {}) {
  const w = store.requireWrestler(wrestlerId);
  const shows = recentShows(showCount);
  const apps = appearances(wrestlerId, shows);

  const dimensions = {
    booking: bookingSatisfaction(w, apps, shows),
    tvTime: tvTimeSatisfaction(w, apps, shows),
    role: roleSatisfaction(w, apps),
    championship: championshipSatisfaction(w),
    contract: contractSatisfaction(w),
    standing: standingSatisfaction(w),
  };

  const weights = weightsFor(w);
  const overall = Math.round(
    DIMENSIONS.reduce((t, key) => t + dimensions[key].score * weights[key], 0)
  );

  const worst = DIMENSIONS
    .map((key) => ({ key, ...dimensions[key], weight: weights[key] }))
    .sort((a, b) => (a.score * (0.5 + a.weight)) - (b.score * (0.5 + b.weight)))[0];

  return { wrestlerId, overall, dimensions, weights, worst, appearances: apps.length, shows: shows.length };
}

/** Morale drifts toward satisfaction rather than toward nothing. */
export function moraleTarget(wrestlerId) {
  return satisfactionOf(wrestlerId).overall;
}
