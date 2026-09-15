// The global event log.
//
// Two jobs, deliberately kept in one place:
//
//   1. A durable, append-only record of everything that has happened, stored in
//      the save file. This is what lets a system built later reason about the
//      past it was not present for - a rivalry system can ask "what happened
//      between w_0003 and w_0007" and get an answer covering months of play.
//   2. A live bus, so systems can react the moment something happens.
//
// This module is pure: it validates and queries, but it does not own the log
// array or know what day it is. store.js owns the array and stamps each event.
// That split is what keeps the dependency graph acyclic.

/**
 * Every event type in the game. Systems must use a registered type - `emit`
 * rejects anything else - so a future system cannot quietly introduce a
 * parallel vocabulary that nothing else is listening for.
 *
 * Naming is `domain.thing.happened`, past tense, because an event is a record
 * of something that already occurred, not a command.
 */
export const EVENT_TYPES = Object.freeze({
  // --- game lifecycle ---
  GAME_CREATED:        'game.created',
  GAME_LOADED:         'game.loaded',
  GAME_SAVED:          'game.saved',

  // --- calendar ---
  CALENDAR_ADVANCED:   'calendar.advanced',
  CALENDAR_SCHEDULED:  'calendar.entry.scheduled',
  CALENDAR_DUE:        'calendar.entry.due',

  // --- roster ---
  WRESTLER_CREATED:    'wrestler.created',
  WRESTLER_UPDATED:    'wrestler.updated',
  WRESTLER_STATE:      'wrestler.state.changed',
  WRESTLER_STANDING:   'wrestler.standing.changed',
  WRESTLER_MEMORY:     'wrestler.memory.added',
  WRESTLER_RELATION:   'wrestler.relationship.changed',
  WRESTLER_GM_TIE:     'wrestler.gm_tie.changed',

  // --- championships and rankings ---
  TITLE_CREATED:       'title.created',
  TITLE_WON:           'title.won',
  TITLE_DEFENDED:      'title.defended',
  TITLE_VACATED:       'title.vacated',
  RANKING_UPDATED:     'ranking.updated',
  CONTENDER_CHANGED:   'contender.changed',

  // --- what the roster wants ---
  REQUEST_MADE:        'request.made',
  REQUEST_GRANTED:     'request.granted',
  REQUEST_DENIED:      'request.denied',
  REQUEST_IGNORED:     'request.ignored',

  // --- shows and cards ---
  SHOW_CREATED:        'show.created',
  SHOW_STARTED:        'show.started',
  SHOW_COMPLETED:      'show.completed',
  SEGMENT_BOOKED:      'segment.booked',
  SEGMENT_UPDATED:     'segment.updated',
  SEGMENT_CUT:         'segment.cut',
  SEGMENT_COMPLETED:   'segment.completed',

  // --- Reserved. No system emits these yet. They are declared here so that
  // when those systems arrive they extend this log rather than starting a
  // second one, and so listeners can be written against them in advance.
  MATCH_RESULT:        'match.result.recorded',
  PROMISE_MADE:        'promise.made',
  PROMISE_KEPT:        'promise.kept',
  PROMISE_BROKEN:      'promise.broken',
  INCIDENT_STARTED:    'incident.started',
  INCIDENT_ESCALATED:  'incident.escalated',
  INCIDENT_RESOLVED:   'incident.resolved',
  RIVALRY_FORMED:      'rivalry.formed',
  CONTRACT_SIGNED:     'contract.signed',
  CONTRACT_EXPIRED:    'contract.expired',
  BOOKING_REFUSED:     'booking.refused',
});

const VALID_TYPES = new Set(Object.values(EVENT_TYPES));

export function isValidEventType(type) {
  return VALID_TYPES.has(type);
}

/**
 * Shape every event shares.
 *
 * `subjects` is the indexed field: every entity the event is *about*, so that
 * "everything that ever happened to w_0003" is one lookup rather than a scan of
 * each system's own records. `causeId` chains an event to the event that
 * produced it, which is how the design's "receipt" requirement survives into
 * the data - any consequence can be walked back to its cause.
 */
export function makeEvent({
  id, seq, day, type, summary = '',
  actorId = null, subjects = [], showId = null, segmentId = null,
  causeId = null, data = {},
}) {
  if (!isValidEventType(type)) {
    throw new Error(`Unregistered event type "${type}". Add it to EVENT_TYPES.`);
  }
  return {
    id, seq, day, type, summary,
    actorId,
    subjects: Array.from(new Set(subjects.filter(Boolean))),
    showId, segmentId, causeId,
    data,
    wallClock: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Live bus
// ---------------------------------------------------------------------------

const listeners = new Map(); // pattern -> Set<fn>

/**
 * Subscribe to a type, a namespace wildcard (`'segment.*'`), or everything
 * (`'*'`). Returns an unsubscribe function.
 */
export function on(pattern, fn) {
  if (!listeners.has(pattern)) listeners.set(pattern, new Set());
  listeners.get(pattern).add(fn);
  return () => off(pattern, fn);
}

export function off(pattern, fn) {
  listeners.get(pattern)?.delete(fn);
}

export function clearListeners() {
  listeners.clear();
}

function patternsFor(type) {
  const out = ['*', type];
  const parts = type.split('.');
  for (let i = 1; i < parts.length; i++) {
    out.push(`${parts.slice(0, i).join('.')}.*`);
  }
  return out;
}

// Dispatch is queued rather than recursive. A listener is allowed to emit -
// that is the whole point of reactive systems - and queueing means the second
// event is appended and delivered after the first finishes, so the log order
// always matches causal order and a listener cannot re-enter mid-append.
let dispatching = false;
const queue = [];

export function dispatch(event) {
  queue.push(event);
  if (dispatching) return;
  dispatching = true;
  try {
    while (queue.length) {
      const e = queue.shift();
      for (const pattern of patternsFor(e.type)) {
        const set = listeners.get(pattern);
        if (!set) continue;
        for (const fn of Array.from(set)) {
          try {
            fn(e);
          } catch (err) {
            // A broken listener must not abort the emit or corrupt the log.
            console.error(`Listener for ${pattern} threw on ${e.type}:`, err);
          }
        }
      }
    }
  } finally {
    dispatching = false;
  }
}

// ---------------------------------------------------------------------------
// Queries over a log array
// ---------------------------------------------------------------------------

/**
 * Filter the log. Every argument is optional and they combine with AND.
 * `subjectId` matches the actor as well as the subjects, since "involved in"
 * is what callers almost always mean.
 */
export function query(log, {
  type, types, subjectId, showId, segmentId, since, until, limit, newestFirst = false,
} = {}) {
  const wanted = types ? new Set(types) : null;
  let out = log.filter((e) => {
    if (type && e.type !== type) return false;
    if (wanted && !wanted.has(e.type)) return false;
    if (showId && e.showId !== showId) return false;
    if (segmentId && e.segmentId !== segmentId) return false;
    if (since != null && e.day < since) return false;
    if (until != null && e.day > until) return false;
    if (subjectId && e.actorId !== subjectId && !e.subjects.includes(subjectId)) return false;
    return true;
  });
  if (newestFirst) out = out.reverse();
  if (limit != null) out = out.slice(0, limit);
  return out;
}

/** Everything that ever happened to or because of one entity. */
export function historyOf(log, entityId, opts = {}) {
  return query(log, { ...opts, subjectId: entityId });
}

/** Walk an event back through `causeId` to the root cause. */
export function causeChain(log, eventId) {
  const byId = new Map(log.map((e) => [e.id, e]));
  const chain = [];
  let cur = byId.get(eventId);
  while (cur) {
    chain.push(cur);
    cur = cur.causeId ? byId.get(cur.causeId) : null;
    if (chain.length > 100) break; // corrupt save guard
  }
  return chain;
}
