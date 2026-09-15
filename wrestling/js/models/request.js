// What a wrestler asks the GM for.
//
// A request is a first-class entity with an ID, because it has a life: it is
// made, it sits open for a while, and it is granted, refused, or quietly
// ignored - and which of those three happened is exactly the sort of thing a
// wrestler remembers about a GM.
//
// Nothing in a request is random. Every one carries the reasons that produced
// it, drawn from the record, the rankings, the relationships and the memories,
// so the GM can always see why they are being asked.

import { mint } from '../core/ids.js';

export const REQUEST_KINDS = Object.freeze({
  TITLE_SHOT: 'title_shot',
  MORE_TV_TIME: 'more_tv_time',
  MORE_SEGMENT_TIME: 'more_segment_time',
  MATCH_WITH: 'match_with',
  FACE_RIVAL: 'face_rival',
  AVOID: 'avoid',
  TAG_WITH: 'tag_with',
  BETTER_ROLE: 'better_role',
});

export const REQUEST_LABEL = Object.freeze({
  [REQUEST_KINDS.TITLE_SHOT]: 'Title shot',
  [REQUEST_KINDS.MORE_TV_TIME]: 'More television time',
  [REQUEST_KINDS.MORE_SEGMENT_TIME]: 'Longer matches',
  [REQUEST_KINDS.MATCH_WITH]: 'A match with somebody',
  [REQUEST_KINDS.FACE_RIVAL]: 'To settle it with a rival',
  [REQUEST_KINDS.AVOID]: 'To stop working with somebody',
  [REQUEST_KINDS.TAG_WITH]: 'To team with somebody',
  [REQUEST_KINDS.BETTER_ROLE]: 'A better spot on the card',
});

/** The same thing as a noun, for dropping into a sentence. */
export const REQUEST_NOUN = Object.freeze({
  [REQUEST_KINDS.TITLE_SHOT]: 'a title shot',
  [REQUEST_KINDS.MORE_TV_TIME]: 'more television time',
  [REQUEST_KINDS.MORE_SEGMENT_TIME]: 'longer matches',
  [REQUEST_KINDS.MATCH_WITH]: 'a match with somebody',
  [REQUEST_KINDS.FACE_RIVAL]: 'a match with a rival',
  [REQUEST_KINDS.AVOID]: 'to be kept away from somebody',
  [REQUEST_KINDS.TAG_WITH]: 'a tag team partner',
  [REQUEST_KINDS.BETTER_ROLE]: 'a better spot on the card',
});

export const REQUEST_STATUS = Object.freeze({
  OPEN: 'open',
  GRANTED: 'granted',
  DENIED: 'denied',
  IGNORED: 'ignored',
});

/** How many shows a request stays open before it counts as ignored. */
export const DEFAULT_LIFESPAN_SHOWS = 1;

export function createRequest(spec = {}) {
  const {
    id = mint('request'),
    wrestlerId,
    kind,
    day,
    targetId = null,
    titleId = null,
    urgency = 50,
    strength = 50,
    reasons = [],
    text = '',
  } = spec;

  if (!wrestlerId) throw new Error('createRequest: wrestlerId is required');
  if (!Object.values(REQUEST_KINDS).includes(kind)) {
    throw new Error(`createRequest: unknown kind "${kind}"`);
  }

  return {
    id, wrestlerId, kind, day,
    targetId,      // another wrestler, for the ones that are about a person
    titleId,       // a championship, for a title shot
    urgency: Math.max(0, Math.min(100, Math.round(urgency))),
    strength: Math.max(0, Math.min(100, Math.round(strength))),
    // Why they are asking. Straight from the world, never invented.
    reasons,
    // What they actually say.
    text,
    status: REQUEST_STATUS.OPEN,
    resolvedOnDay: null,
    resolvedBySegmentId: null,
  };
}

export function isOpen(request) {
  return request.status === REQUEST_STATUS.OPEN;
}

/** Requests about a person, which is most of them. */
export const PERSON_KINDS = Object.freeze([
  REQUEST_KINDS.MATCH_WITH, REQUEST_KINDS.FACE_RIVAL,
  REQUEST_KINDS.AVOID, REQUEST_KINDS.TAG_WITH,
]);

export function validateRequest(r) {
  const problems = [];
  if (!r.wrestlerId) problems.push('missing wrestlerId');
  if (!Object.values(REQUEST_KINDS).includes(r.kind)) problems.push(`unknown kind "${r.kind}"`);
  if (!Object.values(REQUEST_STATUS).includes(r.status)) problems.push(`unknown status "${r.status}"`);
  if (PERSON_KINDS.includes(r.kind) && !r.targetId) problems.push(`${r.kind} has no target`);
  if (r.kind === REQUEST_KINDS.TITLE_SHOT && !r.titleId) problems.push('title_shot has no title');
  if (!Array.isArray(r.reasons) || !r.reasons.length) problems.push('no reasons given');
  return problems;
}
