// The match / segment model.
//
// Matches and non-match segments are ONE model, not two. The design treats the
// card as a list of things that occupy television time and are assigned a time
// limit; a promo that runs long costs the GM exactly what a match that runs long
// costs. Splitting them would mean two clocks, two booking paths and two places
// for a future system to look.
//
// Participants are `{wrestlerId, side, role}` - never wrestler objects. `side`
// is what makes tag matches, multi-mans and interference fall out of the same
// shape without a second model.

import { mint, assertId } from '../core/ids.js';

export const SEGMENT_KINDS = Object.freeze({
  MATCH: 'match',
  PROMO: 'promo',
  ANGLE: 'angle',
  INTERVIEW: 'interview',
});

export const SEGMENT_STATUS = Object.freeze({
  BOOKED: 'booked',
  LIVE: 'live',
  COMPLETE: 'complete',
  CUT: 'cut',
});

/** How a match ended. A time-limit draw is a first-class outcome, not a failure. */
export const FINISHES = Object.freeze({
  PINFALL: 'pinfall',
  SUBMISSION: 'submission',
  COUNTOUT: 'countout',
  DQ: 'disqualification',
  TIME_LIMIT_DRAW: 'time_limit_draw',
  NO_CONTEST: 'no_contest',
  SEGMENT_END: 'segment_end', // non-match segments simply end
});

export const ROLES = Object.freeze({
  COMPETITOR: 'competitor',
  SPEAKER: 'speaker',
  MANAGER: 'manager',
  INTERVIEWER: 'interviewer',
  RUN_IN: 'run_in',
});

/**
 * How a wrestler answered when this was pitched to them. The pitch system is
 * not built yet; the field exists so that when it is, the reaction is recorded
 * against the booking that caused it rather than in a separate store.
 */
export const PITCH_RESPONSE = Object.freeze({
  ACCEPTED: 'accepted',
  RESENTED: 'accepted_resentfully',
  PUSHED_BACK: 'pushed_back',
  REFUSED: 'refused',
});

export function createParticipant(wrestlerId, { side = 'a', role = ROLES.COMPETITOR } = {}) {
  assertId(wrestlerId, 'wrestler', 'segment participant');
  return { wrestlerId, side, role };
}

export function createSegment(spec = {}) {
  const {
    id = mint('segment'),
    showId,
    kind = SEGMENT_KINDS.MATCH,
    name = '',
    order = 0,
    timeLimitSec = 10 * 60,
    participants = [],
    stipulation = null,
    titleId = null,       // reserved: championship system not built
    bookedOnDay = null,
  } = spec;

  assertId(showId, 'show', 'segment.showId');

  return {
    id,
    showId,
    kind,
    name,
    order,
    stipulation,
    titleId,

    // The GM assigns a LIMIT, never a duration. What the segment actually runs
    // is decided by the simulation and recorded in `result.actualSec`.
    timeLimitSec,

    participants: participants.map((p) =>
      typeof p === 'string' ? createParticipant(p) : createParticipant(p.wrestlerId, p)
    ),

    status: SEGMENT_STATUS.BOOKED,

    booking: {
      bookedOnDay,
      // One entry per wrestler pitched, filled in by the pitch system later.
      reactions: [], // {wrestlerId, response, reason, eventId}
    },

    result: {
      finish: null,          // one of FINISHES
      winnerIds: [],
      loserIds: [],
      actualSec: 0,
      quality: null,         // set by the match simulation, not yet built
      overridden: false,     // true when the player forced this result
      beats: [],             // minute-by-minute log, written by the simulation
    },
  };
}

export function participantIds(segment) {
  return segment.participants.map((p) => p.wrestlerId);
}

export function sideOf(segment, wrestlerId) {
  return segment.participants.find((p) => p.wrestlerId === wrestlerId)?.side ?? null;
}

/** Wrestler IDs grouped by side: `{a: [...], b: [...]}`. */
export function sides(segment) {
  const out = {};
  for (const p of segment.participants) {
    (out[p.side] ||= []).push(p.wrestlerId);
  }
  return out;
}

export function isMatch(segment) {
  return segment.kind === SEGMENT_KINDS.MATCH;
}

/** Did this segment go the distance? */
export function wentToLimit(segment) {
  return segment.result.finish === FINISHES.TIME_LIMIT_DRAW;
}

/** Signed seconds against the assigned limit. Negative means it ended early. */
export function timeDelta(segment) {
  return segment.result.actualSec - segment.timeLimitSec;
}
