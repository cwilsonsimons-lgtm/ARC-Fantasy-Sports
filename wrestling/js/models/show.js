// The show model.
//
// A show is a dated container with a time budget and an ordered list of segment
// IDs. It does not embed its segments: they live in `state.segments` with their
// own IDs so that anything else in the game - a memory, a rivalry, a ranking
// justification - can point at one specific match years later.

import { mint } from '../core/ids.js';
import { SHOW_KINDS, DEFAULT_BUDGET_SEC } from '../core/clock.js';

export const SHOW_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  COMPLETE: 'complete',
});

export { SHOW_KINDS };

export function createShow(spec = {}) {
  const {
    id = mint('show'),
    name,
    day,
    kind = SHOW_KINDS.TV,
    calendarEntryId = null,
    timeBudgetSec = DEFAULT_BUDGET_SEC[kind] ?? DEFAULT_BUDGET_SEC[SHOW_KINDS.TV],
    brandId = null,
  } = spec;

  if (day == null) throw new Error('createShow: day is required');

  return {
    id,
    name: name || (kind === SHOW_KINDS.PLE ? 'Premium Live Event' : 'Weekly TV'),
    kind,
    day,
    calendarEntryId,
    brandId,
    status: SHOW_STATUS.SCHEDULED,

    // The booked budget. The gap between this and what the card actually runs
    // is the live-show problem the design is built around, so both are tracked.
    timeBudgetSec,
    segmentIds: [],

    result: {
      rating: null,          // set by a show-grading system, not yet built
      bookedSec: 0,          // sum of assigned time limits
      actualSec: 0,          // sum of what the segments really ran
      startedOnDay: null,
      completedOnDay: null,
    },
  };
}

/** Sum of the time limits assigned to this show's card. */
export function bookedSeconds(show, segmentsById) {
  return show.segmentIds.reduce(
    (t, id) => t + (segmentsById[id]?.timeLimitSec || 0), 0
  );
}

/** Sum of what the card has actually run so far. */
export function actualSeconds(show, segmentsById) {
  return show.segmentIds.reduce(
    (t, id) => t + (segmentsById[id]?.result?.actualSec || 0), 0
  );
}

/**
 * Television left to fill, in seconds. Negative means the card is over budget.
 * This is the number the whole live show is played against.
 */
export function remainingSeconds(show, segmentsById) {
  return show.timeBudgetSec - bookedSeconds(show, segmentsById);
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Signed duration, for gaps: "+1:10" / "-6:10". */
export function formatDelta(sec) {
  const sign = sec < 0 ? '-' : '+';
  return sign + formatDuration(Math.abs(sec));
}
