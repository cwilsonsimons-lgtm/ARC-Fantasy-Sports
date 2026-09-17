// What reaches the GM, and when.
//
// The design foundation is insistent on one point: an event happening and the
// GM knowing about it are two different things. A notification is the second of
// those. It is a separate entity from the event it describes, because it has
// its own timing, its own source, and its own accuracy - the same event can
// reach the GM instantly and correctly, or twenty minutes late from somebody
// with a reason to shade it, or not at all.

import { mint } from '../core/ids.js';

export const RELIABILITY = Object.freeze({
  /** Saw it happen. */
  WITNESSED: 'witnessed',
  /** Told by somebody who was there. */
  FIRSTHAND: 'firsthand',
  /** Told by somebody who was told. */
  SECONDHAND: 'secondhand',
  /** Somebody mentioned something. Details are wrong or missing. */
  RUMOUR: 'rumour',
});

export const RELIABILITY_LABEL = Object.freeze({
  [RELIABILITY.WITNESSED]: 'Saw it',
  [RELIABILITY.FIRSTHAND]: 'First hand',
  [RELIABILITY.SECONDHAND]: 'Second hand',
  [RELIABILITY.RUMOUR]: 'Rumour',
});

/** Confidence a notification of each kind deserves, 0-100. */
export const RELIABILITY_SCORE = Object.freeze({
  [RELIABILITY.WITNESSED]: 100,
  [RELIABILITY.FIRSTHAND]: 80,
  [RELIABILITY.SECONDHAND]: 55,
  [RELIABILITY.RUMOUR]: 30,
});

export function createNotification(spec = {}) {
  const {
    id = mint('notification'),
    eventId = null,
    locationId,
    aboutIds = [],
    reliability = RELIABILITY.WITNESSED,
    sourceWrestlerId = null,
    raisedTick,
    dueTick,
    summary,
    detail = '',
  } = spec;

  if (!summary) throw new Error('createNotification: summary is required');

  return {
    id, eventId, locationId, aboutIds,
    reliability,
    sourceWrestlerId,   // who told the GM, null when they saw it themselves
    raisedTick,         // when it actually happened
    dueTick,            // when the GM finds out
    deliveredTick: null,
    read: false,
    summary,            // what the GM is told, which may not be what happened
    detail,
  };
}

export function isDelivered(n) { return n.deliveredTick != null; }
export function confidenceOf(n) { return RELIABILITY_SCORE[n.reliability] ?? 50; }

/** How late the news was, in seconds. */
export function lateness(n) {
  return n.deliveredTick == null ? null : Math.max(0, n.deliveredTick - n.raisedTick);
}

export function validateNotification(n) {
  const problems = [];
  if (!n.summary) problems.push('missing summary');
  if (!Object.values(RELIABILITY).includes(n.reliability)) {
    problems.push(`unknown reliability "${n.reliability}"`);
  }
  if (!Number.isFinite(n.raisedTick)) problems.push('raisedTick is not a number');
  if (!Number.isFinite(n.dueTick)) problems.push('dueTick is not a number');
  if (n.dueTick < n.raisedTick) problems.push('news arrives before it happened');
  return problems;
}
