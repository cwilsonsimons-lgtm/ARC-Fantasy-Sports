// Something going wrong backstage.
//
// An incident is a first-class entity for the same reason a request is: it has
// a life. It starts because of something, it sits there needing the GM, and it
// ends one of several ways - and which way it ended is exactly the sort of
// thing the people in it remember about you.
//
// Two rules the whole tier hangs on:
//
//   1. **Nothing here is a bare dice roll.** Every incident carries the reasons
//      that produced it, drawn from hostility, personality, morale, memories
//      and the card. If the GM cannot see why it happened, it should not have.
//   2. **You can only answer what you know about.** An incident is raised
//      whether or not the GM is in the room, and it becomes answerable only
//      when Tier 7's notification layer actually tells them. Some never do.
//
// This file owns the vocabulary and the shape. `systems/incidents.js` owns when
// one happens and what answering it costs.

import { mint } from '../core/ids.js';

export const INCIDENT_KINDS = Object.freeze({
  ARGUMENT: 'argument',
  FIGHT: 'fight',
  COMPLAINT: 'complaint',
  REFUSAL: 'refusal',
  CONFRONTATION: 'confrontation',
  MEETING_REQUEST: 'meeting_request',
});

/**
 * What each kind is.
 *
 * `between` marks the ones that happen between wrestlers, where the GM is a
 * referee; the rest are aimed at the GM, where the GM is a party. That single
 * flag is what decides whether mediating is even a sensible thing to offer.
 */
export const INCIDENT_SPECS = Object.freeze({
  [INCIDENT_KINDS.ARGUMENT]: {
    kind: INCIDENT_KINDS.ARGUMENT,
    label: 'Argument',
    noun: 'an argument',
    between: true,
    baseSeverity: 22,
  },
  [INCIDENT_KINDS.FIGHT]: {
    kind: INCIDENT_KINDS.FIGHT,
    label: 'Backstage fight',
    noun: 'a fight',
    between: true,
    baseSeverity: 48,
  },
  [INCIDENT_KINDS.CONFRONTATION]: {
    kind: INCIDENT_KINDS.CONFRONTATION,
    label: 'Post-match confrontation',
    noun: 'a confrontation coming back through the curtain',
    between: true,
    baseSeverity: 30,
  },
  [INCIDENT_KINDS.COMPLAINT]: {
    kind: INCIDENT_KINDS.COMPLAINT,
    label: 'Complaint',
    noun: 'a complaint',
    between: false,
    baseSeverity: 17,
  },
  [INCIDENT_KINDS.REFUSAL]: {
    kind: INCIDENT_KINDS.REFUSAL,
    label: 'Refusal',
    noun: 'a refusal to go out',
    between: false,
    baseSeverity: 46,
  },
  [INCIDENT_KINDS.MEETING_REQUEST]: {
    kind: INCIDENT_KINDS.MEETING_REQUEST,
    label: 'Request for a meeting',
    noun: 'somebody wanting a word',
    between: false,
    baseSeverity: 13,
  },
});

export const INCIDENT_KEYS = Object.freeze(Object.keys(INCIDENT_SPECS));

export function incidentSpec(kind) {
  const spec = INCIDENT_SPECS[kind];
  if (!spec) throw new Error(`Unknown incident kind "${kind}". Add it to INCIDENT_SPECS.`);
  return spec;
}

export function isKnownIncidentKind(kind) {
  return kind in INCIDENT_SPECS;
}

export const INCIDENT_STATUS = Object.freeze({
  OPEN: 'open',
  RESOLVED: 'resolved',
  /** The night ended with it still sitting there. */
  UNRESOLVED: 'unresolved',
});

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * 0-100, like everything else in the game. The bands are what the screen shows
 * and what the response costs are scaled against, so a crisis is expensive to
 * ignore and friction is cheap.
 */
const SEVERITY_BANDS = Object.freeze([
  [76, 'Crisis'],
  [54, 'Serious'],
  [31, 'Flare-up'],
  [0, 'Friction'],
]);

export function severityLabel(severity) {
  return SEVERITY_BANDS.find(([min]) => severity >= min)[1];
}

/** Friction and flare-ups are the floor of the format, not the interesting part. */
export function isSerious(incident) {
  return incident.severity >= 54;
}

// ---------------------------------------------------------------------------
// What the GM can do about it
// ---------------------------------------------------------------------------

export const RESPONSES = Object.freeze({
  IGNORE: 'ignore',
  TALK: 'talk',
  MEDIATE: 'mediate',
  SECURITY: 'security',
  WARNING: 'warning',
  EJECTION: 'ejection',
  SUSPENSION: 'suspension',
  BOOK_MATCH: 'book_match',
});

/**
 * The eight answers, in the order they are offered.
 *
 * Deliberate: the ones that cost the GM something and keep the relationship
 * come first, the ones that remove a person come late, and doing nothing comes
 * last. A screen that puts Ignore under the reader's thumb is a screen that
 * teaches the GM to ignore things.
 *
 * `needsPresence` is the Tier 7 bill coming due: talking to somebody means
 * being in the room with them, and crossing the building costs show clock. The
 * other six are things you can send rather than do, which is precisely why they
 * are worse for the relationship.
 *
 * `seconds` is what the answer costs on top of the walk.
 */
export const RESPONSE_SPECS = Object.freeze({
  [RESPONSES.TALK]: {
    key: RESPONSES.TALK,
    label: 'Talk to them',
    blurb: 'One on one. Costs you two minutes of the night and works on whether they believe you.',
    needsPresence: true,
    minParticipants: 1,
    seconds: 120,
  },
  [RESPONSES.MEDIATE]: {
    key: RESPONSES.MEDIATE,
    label: 'Mediate',
    blurb: 'Both of them, in a room, until it is settled. Four minutes, and harder than talking.',
    needsPresence: true,
    minParticipants: 2,
    betweenOnly: true,
    seconds: 240,
  },
  [RESPONSES.BOOK_MATCH]: {
    key: RESPONSES.BOOK_MATCH,
    label: 'Book the match',
    blurb: 'Put the problem on television. The heat stays; now it is yours.',
    needsPresence: false,
    minParticipants: 2,
    betweenOnly: true,
    seconds: 90,
    alwaysLands: true,
  },
  [RESPONSES.WARNING]: {
    key: RESPONSES.WARNING,
    label: 'Formal warning',
    blurb: 'On the record. A professional takes it; somebody who is not resents it.',
    needsPresence: false,
    minParticipants: 1,
    seconds: 30,
    alwaysLands: true,
  },
  [RESPONSES.SECURITY]: {
    key: RESPONSES.SECURITY,
    label: 'Send security',
    blurb: 'Always works, immediately, and they will not forgive being handled.',
    needsPresence: false,
    minParticipants: 1,
    betweenOnly: true,
    seconds: 60,
    alwaysLands: true,
  },
  [RESPONSES.EJECTION]: {
    key: RESPONSES.EJECTION,
    label: 'Send them home',
    blurb: 'Out of the building tonight, and off the rest of the card with them.',
    needsPresence: false,
    minParticipants: 1,
    seconds: 90,
    alwaysLands: true,
    liveShowOnly: true,
  },
  [RESPONSES.SUSPENSION]: {
    key: RESPONSES.SUSPENSION,
    label: 'Suspend',
    blurb: 'Off television for a fortnight. The heaviest thing you can do, and never forgotten.',
    needsPresence: false,
    minParticipants: 1,
    seconds: 60,
    alwaysLands: true,
  },
  [RESPONSES.IGNORE]: {
    key: RESPONSES.IGNORE,
    label: 'Ignore',
    blurb: 'Let it go. They will notice that you did.',
    needsPresence: false,
    minParticipants: 1,
    seconds: 0,
    alwaysLands: true,
  },
});

export const RESPONSE_KEYS = Object.freeze(Object.keys(RESPONSE_SPECS));

export function responseSpec(key) {
  const spec = RESPONSE_SPECS[key];
  if (!spec) throw new Error(`Unknown response "${key}". Add it to RESPONSE_SPECS.`);
  return spec;
}

/** How long a suspension runs. One missed show, plus the week either side of it. */
export const SUSPENSION_DAYS = 14;

// ---------------------------------------------------------------------------
// The entity
// ---------------------------------------------------------------------------

export function createIncident(spec = {}) {
  const {
    id = mint('incident'),
    kind,
    day,
    tick = 0,
    locationId,
    showId = null,
    segmentId = null,
    participantIds = [],
    instigatorId = null,
    targetId = null,
    severity,
    causeEventId = null,
    startedEventId = null,
    reasons = [],
    blocksSegmentId = null,
  } = spec;

  const preset = incidentSpec(kind);
  if (!locationId) throw new Error('createIncident: an incident happens somewhere');
  if (!participantIds.length) throw new Error('createIncident: an incident happens to somebody');

  return {
    id,
    kind,
    day,
    tick,                 // where in the night it happened
    locationId,
    showId,
    segmentId,            // the segment it came out of, if any
    participantIds,
    instigatorId: instigatorId || participantIds[0],
    targetId,             // the other wrestler, when it is between two people
    severity: Math.max(1, Math.min(100, Math.round(severity ?? preset.baseSeverity))),
    causeEventId,         // the event UPSTREAM of it: the match, the walk, the show
    startedEventId,       // its OWN entry in the log, which is what reads as its headline
    reasons,              // [{label, detail, weight}] - why this happened, never hidden

    status: INCIDENT_STATUS.OPEN,

    // Tier 7 decides this. Null means the GM never found out, and an incident
    // the GM never found out about cannot be held against them.
    discoveredTick: null,
    notificationId: null,

    // What the GM did, and what came of it.
    response: null,
    respondedOnTick: null,
    attempted: [],        // responses already tried, so none can be spammed
    outcome: null,        // {landed, summary, effects:[...]}

    // A refusal stops the match it is a refusal of.
    blocksSegmentId,
  };
}

export function isOpen(incident) {
  return incident.status === INCIDENT_STATUS.OPEN;
}

export function isKnown(incident) {
  return incident.discoveredTick != null;
}

/** Open, and the GM has actually been told. The only ones they can answer. */
export function isAnswerable(incident) {
  return isOpen(incident) && isKnown(incident);
}

export function validateIncident(inc) {
  const problems = [];
  if (!isKnownIncidentKind(inc.kind)) problems.push(`unknown kind "${inc.kind}"`);
  if (!inc.locationId) problems.push('no location');
  if (!inc.participantIds?.length) problems.push('no participants');
  if (!Number.isFinite(inc.severity)) problems.push('severity is not a number');
  if (inc.severity < 1 || inc.severity > 100) problems.push(`severity ${inc.severity} out of range`);
  if (!Object.values(INCIDENT_STATUS).includes(inc.status)) {
    problems.push(`unknown status "${inc.status}"`);
  }
  if (inc.response && !(inc.response in RESPONSE_SPECS)) {
    problems.push(`unknown response "${inc.response}"`);
  }
  if (inc.status === INCIDENT_STATUS.RESOLVED && !inc.response) {
    problems.push('resolved with no response recorded');
  }
  return problems;
}
