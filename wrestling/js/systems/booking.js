// Booking rules and helpers.
//
// The store will accept any card you hand it - it is deliberately unopinionated
// about what makes sense. This module holds the judgements: who is already
// working tonight, who is not fit to, and roughly how much television a card is
// actually going to fill.
//
// Tier 1 rules only. Nothing here asks whether the wrestler WANTS the match;
// that is the pitch system, and it belongs to the next tier.

import * as store from '../core/store.js';
import { SEGMENT_KINDS, SEGMENT_STATUS } from '../models/segment.js';
import { isAvailable, isSuspended, canBeBooked } from '../models/wrestler.js';
import { formatOf, slotCount } from './formats.js';
import { championIds, isVacant } from '../models/title.js';

/**
 * Matches usually end before their limit, so a card booked to exactly fill the
 * hour will leave the GM with dead air. This is the observed median fill from
 * the simulation, used ONLY to show an estimate on the booking screen - the
 * simulation itself never consults it.
 */
export const TYPICAL_FILL_RATIO = 0.62;

/** Everyone already in a match on this card. */
export function alreadyWrestling(showId) {
  const ids = new Set();
  for (const seg of store.segmentsOfShow(showId)) {
    if (seg.kind !== SEGMENT_KINDS.MATCH) continue;
    if (seg.status === SEGMENT_STATUS.CUT) continue;
    for (const p of seg.participants) ids.add(p.wrestlerId);
  }
  return ids;
}

/** Everyone appearing on this card in any capacity. */
export function alreadyBooked(showId) {
  const ids = new Set();
  for (const seg of store.segmentsOfShow(showId)) {
    if (seg.status === SEGMENT_STATUS.CUT) continue;
    for (const p of seg.participants) ids.add(p.wrestlerId);
  }
  return ids;
}

/**
 * Can this card take this segment?
 *
 * Returns `{ok, problems}` rather than throwing, because the booking screen
 * wants to explain the problem, not catch an exception.
 */
export function validate(showId, formatKey, wrestlerIds, { titleId = null } = {}) {
  const problems = [];
  const warnings = [];
  const format = formatOf(formatKey);
  const filled = wrestlerIds.filter(Boolean);

  if (filled.length !== slotCount(formatKey)) {
    problems.push(`${format.label} needs ${slotCount(formatKey)} people, got ${filled.length}`);
  }

  const seen = new Set();
  for (const id of filled) {
    if (seen.has(id)) problems.push(`${store.nameOf(id)} cannot face themselves`);
    seen.add(id);
  }

  const working = alreadyWrestling(showId);
  if (format.kind === SEGMENT_KINDS.MATCH) {
    for (const id of seen) {
      if (working.has(id)) problems.push(`${store.nameOf(id)} is already in a match tonight`);
    }
  }

  const day = store.today();
  for (const id of seen) {
    const w = store.getWrestler(id);
    if (!w) { problems.push(`No wrestler with id ${id}`); continue; }
    if (format.kind === SEGMENT_KINDS.MATCH && !isAvailable(w, day)) {
      problems.push(`${w.name} is not fit to wrestle`);
    }
    // Being suspended is not being injured. It applies to talking segments too:
    // somebody who is off television is off television.
    if (isSuspended(w, day)) {
      problems.push(`${w.name} is suspended until day ${w.state.discipline.suspendedUntilDay}`);
    }
  }

  if (titleId) {
    const title = store.getTitle(titleId);
    if (!title) {
      problems.push(`No title with id ${titleId}`);
    } else {
      if (format.kind !== SEGMENT_KINDS.MATCH) {
        problems.push(`A ${format.label} cannot be for the ${title.shortName} title`);
      }
      const holders = championIds(title);
      if (!isVacant(title) && !holders.some((id) => seen.has(id))) {
        problems.push(`${holders.map(store.nameOf).join(' & ')} holds the ${title.shortName} title and is not in this match`);
      }
      // Booking past the contender is allowed. It is meant to be noticed.
      if (title.contenderId && !seen.has(title.contenderId) && !holders.includes(title.contenderId)) {
        warnings.push(`${store.nameOf(title.contenderId)} is the #1 contender and is not in this match`);
      }
      for (const id of seen) {
        const w = store.getWrestler(id);
        const rank = w?.standing.rank;
        const contender = title.contenderId ? store.getWrestler(title.contenderId) : null;
        if (rank && contender?.standing.rank && rank > contender.standing.rank && !holders.includes(id)) {
          warnings.push(`${w.name} is ranked #${rank}, below the #1 contender`);
        }
      }
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

/**
 * How the card is shaping up against the hour.
 * `expectedSec` is the honest guess, not the sum of the limits: the sum of the
 * limits is the ceiling, and almost no card reaches it.
 */
export function cardOutlook(showId) {
  const show = store.requireShow(showId);
  const segments = store.segmentsOfShow(showId);

  let expectedSec = 0;
  for (const seg of segments) {
    if (seg.status === SEGMENT_STATUS.COMPLETE) expectedSec += seg.result.actualSec;
    else if (seg.kind === SEGMENT_KINDS.MATCH) expectedSec += seg.timeLimitSec * TYPICAL_FILL_RATIO;
    else expectedSec += seg.timeLimitSec * 0.85; // talking segments run closer to their slot
  }

  const bookedSec = segments.reduce((t, s) => t + s.timeLimitSec, 0);
  return {
    bookedSec,
    expectedSec: Math.round(expectedSec),
    budgetSec: show.timeBudgetSec,
    expectedGapSec: Math.round(show.timeBudgetSec - expectedSec),
    ceilingGapSec: show.timeBudgetSec - bookedSec,
  };
}

/** Wrestlers who could still be given something to do tonight. */
export function availableFor(showId, { matchOnly = true } = {}) {
  const working = matchOnly ? alreadyWrestling(showId) : alreadyBooked(showId);
  const day = store.today();
  return store.allWrestlers().filter((w) => !working.has(w.id) && canBeBooked(w, day));
}
