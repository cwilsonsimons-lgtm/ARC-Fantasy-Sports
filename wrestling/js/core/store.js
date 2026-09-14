// The store. One state object, one mutation surface.
//
// Everything in the game lives here, keyed by ID:
//
//   state.wrestlers[id]  the single persistent wrestler entity
//   state.shows[id]      shows, holding ordered segment IDs
//   state.segments[id]   matches and segments, holding participant wrestler IDs
//   state.calendar       game time and the schedule
//   state.log            the append-only global event log
//
// Two rules hold the whole design together, and both are enforced here:
//
//   1. Nothing outside this file mutates state. Every change goes through an
//      action below, so there is no path that changes the world silently.
//   2. Every action emits a structured event. A system written six months from
//      now can subscribe to what it cares about, or read the log back to
//      reconstruct a past it was not present for.
//
// The state object is reached through `G.state` rather than exported directly,
// because loading a save replaces it wholesale and an imported ES binding is
// read-only for the importer. This is the same pattern, for the same reason, as
// js/state.js in the fantasy app alongside it.

import * as ids from './ids.js';
import { createRng } from './rng.js';
import * as events from './events.js';
import { EVENT_TYPES } from './events.js';
import * as clock from './clock.js';
import { createWrestler, createMemory, clampUnit, clampSigned } from '../models/wrestler.js';
import { createShow, SHOW_STATUS, bookedSeconds, actualSeconds } from '../models/show.js';
import { createSegment, SEGMENT_STATUS, participantIds } from '../models/segment.js';

export const SCHEMA_VERSION = 1;

/** The live game. `state` and `rng` are replaced together when a save loads. */
export const G = { state: null, rng: null };

export function getState() { return G.state; }
export function getRng() { return G.rng; }
export function isLoaded() { return G.state != null; }

// Subscriptions are APP-level, not game-level: a system subscribes once at boot
// and reads the current world on each event, so it keeps working across a new
// game or a save load. Only reset() tears them down.
export const on = events.on;
export const off = events.off;

function requireGame() {
  if (!G.state) throw new Error('No game loaded. Call newGame() or loadGame() first.');
  return G.state;
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

/**
 * Record something that happened and tell everyone listening.
 *
 * `cause` is the ID of the event that led to this one. Threading it through
 * every action is what makes the design's "receipt" requirement hold in the
 * data: any consequence can be walked back to its root cause through the log.
 */
export function emit(type, {
  summary = '', actorId = null, subjects = [], showId = null, segmentId = null,
  cause = null, data = {},
} = {}) {
  const state = requireGame();
  const event = events.makeEvent({
    id: ids.mint('event'),
    seq: state.log.length + 1,
    day: state.calendar.day,
    type, summary, actorId, subjects, showId, segmentId,
    causeId: cause,
    data,
  });
  state.log.push(event);
  events.dispatch(event);
  return event;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function newGame({
  seed = String(Date.now()),
  gmName = 'New GM',
  brandName = 'Weekly Showcase',
  mode = 'sandbox',            // 'sandbox' | 'competitive'
  startDate = '2026-01-05',
  scheduleBlocks = 3,
  roster = [],
} = {}) {
  ids.resetCounters();
  G.rng = createRng(seed);
  G.state = {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      gameId: `wgm-${seed}`,
      seed,
      gmName,
      brandName,
      mode,
      createdAt: new Date().toISOString(),
    },
    calendar: clock.createCalendar(startDate),
    wrestlers: {},
    shows: {},
    segments: {},
    log: [],
  };

  emit(EVENT_TYPES.GAME_CREATED, {
    summary: `${gmName} takes over ${brandName}`,
    data: { seed, mode, startDate },
  });

  for (const spec of roster) addWrestler(spec);
  if (scheduleBlocks > 0) scheduleProgramming(scheduleBlocks);

  return G.state;
}

/** Install a state object loaded from a save. persist.js owns validation. */
export function installState(state, rngState, { seed } = {}) {
  G.state = state;
  G.rng = createRng(seed || state.meta.seed || 'restored');
  if (rngState) G.rng.setState(rngState);
  // Push ID counters past everything present, so a mint can never collide.
  ids.syncCountersTo([
    ...Object.keys(state.wrestlers),
    ...Object.keys(state.shows),
    ...Object.keys(state.segments),
    ...state.log.map((e) => e.id),
    ...Object.values(state.wrestlers).flatMap((w) => w.memory.map((m) => m.id)),
    ...state.calendar.entries.map((e) => e.id),
  ]);
  return G.state;
}

export function reset() {
  G.state = null;
  G.rng = null;
  ids.resetCounters();
  events.clearListeners();
}

// ---------------------------------------------------------------------------
// Reads. These return the LIVE entity, never a copy - holding a copy is how a
// second, diverging version of a wrestler gets created.
// ---------------------------------------------------------------------------

export function getWrestler(id) { return requireGame().wrestlers[id] || null; }
export function getShow(id) { return requireGame().shows[id] || null; }
export function getSegment(id) { return requireGame().segments[id] || null; }

export function requireWrestler(id) {
  const w = getWrestler(id);
  if (!w) throw new Error(`No wrestler with id ${id}`);
  return w;
}
export function requireShow(id) {
  const s = getShow(id);
  if (!s) throw new Error(`No show with id ${id}`);
  return s;
}
export function requireSegment(id) {
  const s = getSegment(id);
  if (!s) throw new Error(`No segment with id ${id}`);
  return s;
}

export function allWrestlers() { return Object.values(requireGame().wrestlers); }
export function allShows() {
  return Object.values(requireGame().shows).sort((a, b) => a.day - b.day);
}
export function segmentsOfShow(showId) {
  const show = requireShow(showId);
  return show.segmentIds.map((id) => requireSegment(id));
}
export function today() { return requireGame().calendar.day; }

/** Display name for any entity ID, for log lines and UI. */
export function nameOf(id) {
  const state = requireGame();
  return state.wrestlers[id]?.name
    || state.shows[id]?.name
    || state.segments[id]?.name
    || id;
}

// ---------------------------------------------------------------------------
// Roster actions
// ---------------------------------------------------------------------------

export function addWrestler(spec, { cause = null } = {}) {
  const state = requireGame();
  const wrestler = createWrestler({ debutDay: state.calendar.day, ...spec });
  state.wrestlers[wrestler.id] = wrestler;

  // Starting relationships in an authored roster are written as names or IDs of
  // wrestlers who may not exist yet; resolution happens in linkRoster() below.
  emit(EVENT_TYPES.WRESTLER_CREATED, {
    summary: `${wrestler.name} joins the roster`,
    actorId: wrestler.id,
    subjects: [wrestler.id],
    cause,
    data: { careerStatus: wrestler.standing.careerStatus },
  });
  return wrestler;
}

/** Patch the fast-moving layer. Every change is reported with a reason. */
export function updateWrestlerState(id, patch, { reason = '', cause = null } = {}) {
  const w = requireWrestler(id);
  const before = { ...w.state };
  if (patch.morale != null) w.state.morale = clampUnit(patch.morale);
  if (patch.momentum != null) w.state.momentum = clampSigned(patch.momentum);
  if (patch.condition != null) w.state.condition = clampUnit(patch.condition);
  if (patch.mood != null) w.state.mood = patch.mood;
  if (patch.health != null) w.state.health = { ...w.state.health, ...patch.health };

  emit(EVENT_TYPES.WRESTLER_STATE, {
    summary: reason || `${w.name}'s state changed`,
    actorId: id,
    subjects: [id],
    cause,
    data: { before, after: { ...w.state }, reason },
  });
  return w;
}

/** Patch the public record. This is what every later argument will cite. */
export function updateStanding(id, patch, { reason = '', cause = null } = {}) {
  const w = requireWrestler(id);
  const before = { ...w.standing };
  Object.assign(w.standing, patch);

  emit(EVENT_TYPES.WRESTLER_STANDING, {
    summary: reason || `${w.name}'s record changed`,
    actorId: id,
    subjects: [id],
    cause,
    data: { before, after: { ...w.standing }, reason },
  });
  return w;
}

/** Give a wrestler something to remember. */
export function addMemory(id, memorySpec, { cause = null } = {}) {
  const state = requireGame();
  const w = requireWrestler(id);
  const memory = createMemory({ day: state.calendar.day, sourceEventId: cause, ...memorySpec });
  w.memory.push(memory);

  emit(EVENT_TYPES.WRESTLER_MEMORY, {
    summary: `${w.name} remembers: ${memory.summary}`,
    actorId: id,
    subjects: [id, ...memory.aboutIds],
    cause,
    data: { memoryId: memory.id, type: memory.type, weight: memory.weight, scar: memory.scar },
  });
  return memory;
}

/**
 * Move how `fromId` feels about `toId`. Directed on purpose: shifting A's view
 * of B says nothing about B's view of A, which is what lets one wrestler carry
 * a grudge the other never noticed starting.
 */
export function adjustRelationship(fromId, toId, delta, { reason = '', cause = null } = {}) {
  const state = requireGame();
  const from = requireWrestler(fromId);
  requireWrestler(toId);
  if (fromId === toId) throw new Error('A wrestler cannot hold a relationship with themselves');

  const rel = from.ties.relationships[toId] ||= {
    value: 0, lastChangedDay: state.calendar.day, sourceEventIds: [],
  };
  const before = rel.value;
  rel.value = clampSigned(rel.value + delta);
  rel.lastChangedDay = state.calendar.day;

  const event = emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: reason || `${from.name}'s view of ${nameOf(toId)} changed`,
    actorId: fromId,
    subjects: [fromId, toId],
    cause,
    data: { fromId, toId, before, after: rel.value, delta, reason },
  });
  rel.sourceEventIds.push(event.id);
  return rel;
}

/** Move what a wrestler thinks of the GM. Trust and respect move separately. */
export function adjustGmTie(id, { trust = 0, respect = 0 }, { reason = '', cause = null } = {}) {
  const w = requireWrestler(id);
  const before = { ...w.ties.gm };
  w.ties.gm.trust = clampUnit(w.ties.gm.trust + trust);
  w.ties.gm.respect = clampUnit(w.ties.gm.respect + respect);

  emit(EVENT_TYPES.WRESTLER_GM_TIE, {
    summary: reason || `${w.name}'s view of the GM changed`,
    actorId: id,
    subjects: [id],
    cause,
    data: { before, after: { ...w.ties.gm }, reason },
  });
  return w.ties.gm;
}

// ---------------------------------------------------------------------------
// Calendar and shows
// ---------------------------------------------------------------------------

/** Lay out `blocks` months of programming and create a show for each date. */
export function scheduleProgramming(blocks = 3, { cause = null } = {}) {
  const state = requireGame();
  const existingBlocks = new Set(state.calendar.entries.map((e) => e.block));
  const startBlock = existingBlocks.size ? Math.max(...existingBlocks) + 1 : 1;
  const planned = clock.planSchedule(state.calendar, blocks, { startBlock });
  return planned.map((p) => scheduleShow(p, { cause }));
}

/** Put one show on the calendar. Creates the entry and the show together. */
export function scheduleShow({ day, kind, label, block, week }, { cause = null } = {}) {
  const state = requireGame();
  const show = createShow({ name: label, day, kind });
  state.shows[show.id] = show;

  const entry = {
    id: ids.mint('calendarEntry'),
    day,
    kind,
    label: label || show.name,
    showId: show.id,
    block: block ?? clock.blockOf(day),
    week: week ?? clock.weekOf(day),
  };
  show.calendarEntryId = entry.id;
  state.calendar.entries.push(entry);
  state.calendar.entries.sort((a, b) => a.day - b.day);

  const created = emit(EVENT_TYPES.SHOW_CREATED, {
    summary: `${show.name} scheduled for ${clock.formatDate(state.calendar, day)}`,
    subjects: [show.id],
    showId: show.id,
    cause,
    data: { day, kind, calendarEntryId: entry.id },
  });
  emit(EVENT_TYPES.CALENDAR_SCHEDULED, {
    summary: `Calendar: ${entry.label}`,
    subjects: [show.id],
    showId: show.id,
    cause: created.id,
    data: { entryId: entry.id, day, kind },
  });
  return show;
}

/**
 * Move game time forward. Every calendar entry passed on the way becomes a
 * `calendar.entry.due` event, so a system that needs to act on a show day does
 * not have to poll the date.
 */
export function advanceDays(n = 1, { cause = null } = {}) {
  const state = requireGame();
  if (n <= 0) throw new Error('advanceDays: n must be positive');
  const from = state.calendar.day;
  const to = from + n;
  state.calendar.day = to;

  const advanced = emit(EVENT_TYPES.CALENDAR_ADVANCED, {
    summary: `${clock.formatDate(state.calendar, to)} (${clock.formatGameTime(to)})`,
    cause,
    data: { from, to, days: n },
  });

  for (const entry of clock.entriesBetween(state.calendar, from + 1, to)) {
    emit(EVENT_TYPES.CALENDAR_DUE, {
      summary: `${entry.label} is today`,
      subjects: [entry.showId].filter(Boolean),
      showId: entry.showId || null,
      cause: advanced.id,
      data: { entryId: entry.id, day: entry.day, kind: entry.kind },
    });
  }
  return { from, to, event: advanced };
}

export function advanceToDay(day, opts) {
  const state = requireGame();
  return advanceDays(day - state.calendar.day, opts);
}

/** Jump to the next scheduled show. */
export function advanceToNextShow(opts) {
  const state = requireGame();
  const next = clock.nextEntry(state.calendar);
  if (!next) return null;
  return advanceToDay(next.day, opts);
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/**
 * Put a segment on a show's card.
 *
 * The GM assigns a time LIMIT here. Nothing decides how long it actually runs;
 * that is the simulation's job, and it writes to `result.actualSec`.
 */
export function bookSegment(spec, { cause = null } = {}) {
  const state = requireGame();
  const show = requireShow(spec.showId);
  for (const p of spec.participants || []) {
    requireWrestler(typeof p === 'string' ? p : p.wrestlerId);
  }

  const segment = createSegment({
    order: show.segmentIds.length,
    bookedOnDay: state.calendar.day,
    ...spec,
  });
  state.segments[segment.id] = segment;
  show.segmentIds.push(segment.id);
  show.result.bookedSec = bookedSeconds(show, state.segments);

  emit(EVENT_TYPES.SEGMENT_BOOKED, {
    summary: `${segment.name || segment.kind} booked for ${show.name}`,
    subjects: participantIds(segment),
    showId: show.id,
    segmentId: segment.id,
    cause,
    data: {
      kind: segment.kind,
      timeLimitSec: segment.timeLimitSec,
      participants: segment.participants,
    },
  });
  return segment;
}

export function updateSegment(id, patch, { reason = '', cause = null } = {}) {
  const state = requireGame();
  const segment = requireSegment(id);
  const before = { timeLimitSec: segment.timeLimitSec, name: segment.name, order: segment.order };
  if (patch.timeLimitSec != null) segment.timeLimitSec = Math.max(0, Math.round(patch.timeLimitSec));
  if (patch.name != null) segment.name = patch.name;
  if (patch.order != null) segment.order = patch.order;
  if (patch.stipulation !== undefined) segment.stipulation = patch.stipulation;

  const show = requireShow(segment.showId);
  show.result.bookedSec = bookedSeconds(show, state.segments);

  emit(EVENT_TYPES.SEGMENT_UPDATED, {
    summary: reason || `${segment.name || segment.kind} updated`,
    subjects: participantIds(segment),
    showId: segment.showId,
    segmentId: segment.id,
    cause,
    data: { before, after: { timeLimitSec: segment.timeLimitSec, name: segment.name, order: segment.order }, reason },
  });
  return segment;
}

/** Cutting a segment is a real act with victims, so it is recorded as one. */
export function cutSegment(id, { reason = '', cause = null } = {}) {
  const state = requireGame();
  const segment = requireSegment(id);
  segment.status = SEGMENT_STATUS.CUT;
  const show = requireShow(segment.showId);
  show.segmentIds = show.segmentIds.filter((sid) => sid !== id);
  show.result.bookedSec = bookedSeconds(show, state.segments);

  emit(EVENT_TYPES.SEGMENT_CUT, {
    summary: reason || `${segment.name || segment.kind} cut from ${show.name}`,
    subjects: participantIds(segment),
    showId: show.id,
    segmentId: segment.id,
    cause,
    data: { reason },
  });
  return segment;
}

/**
 * Record what happened in a segment.
 *
 * This is the write point the match simulation will use. It only stores the
 * outcome; it deliberately does not update win/loss records, because that is a
 * standings system's job and it should do it by listening for this event. That
 * keeps the result in one place and the record derived from it.
 */
export function completeSegment(id, result, { cause = null } = {}) {
  const state = requireGame();
  const segment = requireSegment(id);
  segment.status = SEGMENT_STATUS.COMPLETE;
  Object.assign(segment.result, result);

  const show = requireShow(segment.showId);
  show.result.actualSec = actualSeconds(show, state.segments);

  return emit(EVENT_TYPES.SEGMENT_COMPLETED, {
    summary: `${segment.name || segment.kind}: ${result.finish || 'ended'}`,
    subjects: participantIds(segment),
    showId: show.id,
    segmentId: segment.id,
    cause,
    data: {
      finish: result.finish,
      winnerIds: result.winnerIds || [],
      loserIds: result.loserIds || [],
      actualSec: result.actualSec || 0,
      timeLimitSec: segment.timeLimitSec,
      overridden: !!result.overridden,
    },
  });
}

export function startShow(id, { cause = null } = {}) {
  const state = requireGame();
  const show = requireShow(id);
  show.status = SHOW_STATUS.LIVE;
  show.result.startedOnDay = state.calendar.day;
  return emit(EVENT_TYPES.SHOW_STARTED, {
    summary: `${show.name} is live`,
    subjects: [show.id],
    showId: show.id,
    cause,
    data: { bookedSec: show.result.bookedSec, budgetSec: show.timeBudgetSec },
  });
}

export function completeShow(id, { rating = null, cause = null } = {}) {
  const state = requireGame();
  const show = requireShow(id);
  show.status = SHOW_STATUS.COMPLETE;
  show.result.completedOnDay = state.calendar.day;
  show.result.rating = rating;
  show.result.actualSec = actualSeconds(show, state.segments);
  return emit(EVENT_TYPES.SHOW_COMPLETED, {
    summary: `${show.name} is off the air`,
    subjects: [show.id],
    showId: show.id,
    cause,
    data: {
      rating,
      bookedSec: show.result.bookedSec,
      actualSec: show.result.actualSec,
      budgetSec: show.timeBudgetSec,
    },
  });
}

// ---------------------------------------------------------------------------
// Log reads
// ---------------------------------------------------------------------------

export function queryLog(opts) { return events.query(requireGame().log, opts); }
export function historyOf(entityId, opts) { return events.historyOf(requireGame().log, entityId, opts); }
export function causeChain(eventId) { return events.causeChain(requireGame().log, eventId); }

/**
 * Install backstory on a wrestler: the relationships and memories that predate
 * the save. This is a single action rather than dozens of relationship events,
 * because none of it *happened* during play - it is the state the game starts in.
 */
export function setBackstory(id, { relationships = {}, memory = [] } = {}, { cause = null } = {}) {
  const state = requireGame();
  const w = requireWrestler(id);

  for (const [otherId, value] of Object.entries(relationships)) {
    requireWrestler(otherId);
    if (otherId === id) throw new Error(`${id} cannot hold a relationship with themselves`);
    w.ties.relationships[otherId] = {
      value: clampSigned(value),
      lastChangedDay: state.calendar.day,
      sourceEventIds: [],
    };
  }
  for (const spec of memory) {
    w.memory.push(createMemory({ day: state.calendar.day, ...spec }));
  }

  emit(EVENT_TYPES.WRESTLER_UPDATED, {
    summary: `${w.name} arrives with history`,
    actorId: id,
    subjects: [id, ...Object.keys(relationships)],
    cause,
    data: {
      relationships: Object.keys(relationships).length,
      memories: memory.length,
    },
  });
  return w;
}
