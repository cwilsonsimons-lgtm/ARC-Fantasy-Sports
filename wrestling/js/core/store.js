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
import { EVENT_TYPES, VISIBILITY } from './events.js';
import * as clock from './clock.js';
import { createWrestler, createMemory, clampUnit, clampSigned } from '../models/wrestler.js';
import { createRelationship, applyDeltas, AXES } from '../models/relationship.js';
import { createShow, SHOW_STATUS, bookedSeconds, actualSeconds } from '../models/show.js';
import { createSegment, SEGMENT_STATUS, participantIds } from '../models/segment.js';
import { createTitle as makeTitle, createReign, currentReign, championIds } from '../models/title.js';
import { createRequest as makeRequest, REQUEST_STATUS, REQUEST_LABEL } from '../models/request.js';
import { createNotification, RELIABILITY } from '../models/notification.js';
import {
  createIncident, INCIDENT_STATUS, INCIDENT_SPECS, isAnswerable, severityLabel,
} from '../models/incident.js';
import { createFaction, isActive as factionIsActive } from '../models/faction.js';
import { createReaction, reactionSpec } from '../models/reaction.js';
import { LOCATIONS, isLocation, locationName, travelSeconds, route } from '../models/location.js';

export const SCHEMA_VERSION = 9;

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
  locationId = null, visibility = VISIBILITY.PUBLIC, newsSummary = '',
} = {}) {
  const state = requireGame();
  const event = events.makeEvent({
    id: ids.mint('event'),
    seq: state.log.length + 1,
    day: state.calendar.day,
    type, summary, actorId, subjects, showId, segmentId,
    causeId: cause,
    data,
    locationId,
    visibility,
    newsSummary,
    tick: state.backstage?.tick ?? 0,
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
      // How fast and how accurately backstage news reaches the GM, 0-100.
      // Raised by the GM skill tree, which is not built: see the design
      // foundation's backstage-awareness branch.
      backstageAwareness: 0,
      createdAt: new Date().toISOString(),
    },
    calendar: clock.createCalendar(startDate),
    wrestlers: {},
    shows: {},
    segments: {},
    titles: {},
    requests: {},
    incidents: {},
    factions: {},
    // Reactions that have been decided but have not happened yet. A slow burn
    // is the same decision with a later tick on it.
    pendingReactions: [],
    // The building. `tick` is seconds into the working night, which is what
    // notification timing is measured in.
    backstage: {
      gmLocation: 'gm_office',
      tick: 0,
      wrestlers: {},        // wrestlerId -> locationId
      notifications: [],    // pending and delivered, newest last
    },
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
    ...Object.keys(state.titles || {}),
    ...Object.keys(state.requests || {}),
    ...Object.keys(state.incidents || {}),
    ...Object.keys(state.factions || {}),
    ...Object.values(state.incidents || {}).flatMap((i) => (i.reactions || []).map((r) => r.id)),
    ...(state.backstage?.notifications || []).map((n) => n.id),
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
export function getTitle(id) { return requireGame().titles[id] || null; }
export function getRequest(id) { return requireGame().requests[id] || null; }

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

export function requireTitle(id) {
  const t = getTitle(id);
  if (!t) throw new Error(`No title with id ${id}`);
  return t;
}

export function allWrestlers() { return Object.values(requireGame().wrestlers); }
export function allTitles() {
  return Object.values(requireGame().titles)
    .sort((a, b) => (a.tier === 'world' ? -1 : 1) - (b.tier === 'world' ? -1 : 1));
}
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
    || state.titles[id]?.name
    || id;
}

// ---------------------------------------------------------------------------
// Roster actions
// ---------------------------------------------------------------------------

export function addWrestler(spec, { cause = null } = {}) {
  const state = requireGame();
  const wrestler = createWrestler({ debutDay: state.calendar.day, ...spec });
  state.wrestlers[wrestler.id] = wrestler;
  // Anybody who exists is standing somewhere. Nowhere is not a place.
  state.backstage.wrestlers[wrestler.id] = 'locker_room';

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

/**
 * Patch the fast-moving layer. Every change is reported with a reason.
 *
 * `silent` suppresses the event, and exists for ambient upkeep that touches the
 * whole roster at once - overnight condition recovery would otherwise put
 * fourteen events in the log for something no system needs to react to
 * individually. A silent caller is expected to emit one summary event of its
 * own. Nothing that a system might want to respond to should use it.
 */
export function updateWrestlerState(id, patch, { reason = '', cause = null, silent = false } = {}) {
  const w = requireWrestler(id);
  const before = { ...w.state };
  if (patch.morale != null) w.state.morale = clampUnit(patch.morale);
  if (patch.momentum != null) w.state.momentum = clampSigned(patch.momentum);
  if (patch.condition != null) w.state.condition = clampUnit(patch.condition);
  if (patch.mood != null) w.state.mood = patch.mood;
  if (patch.health != null) w.state.health = { ...w.state.health, ...patch.health };

  if (silent) return w;
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

/**
 * How many memories one wrestler keeps. Scars are never pruned; beyond the cap
 * the lightest ordinary memories are dropped, which is roughly what forgetting
 * is. Without this a long save accumulates every routine win forever.
 */
export const MEMORY_LIMIT = 60;

/** Give a wrestler something to remember. */
export function addMemory(id, memorySpec, { cause = null } = {}) {
  const state = requireGame();
  const w = requireWrestler(id);
  const memory = createMemory({ day: state.calendar.day, sourceEventId: cause, ...memorySpec });
  w.memory.push(memory);

  if (w.memory.length > MEMORY_LIMIT) {
    const today = state.calendar.day;
    const weigh = (m) => Math.max(m.floor, m.weight - m.decayPerDay * Math.max(0, today - m.day));
    const droppable = w.memory
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !m.scar)
      .sort((a, b) => weigh(a.m) - weigh(b.m));
    const toDrop = new Set(droppable.slice(0, w.memory.length - MEMORY_LIMIT).map((x) => x.i));
    if (toDrop.size) w.memory = w.memory.filter((_, i) => !toDrop.has(i));
  }

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
 * Move how `fromId` feels about `toId`, across any of the four axes.
 *
 * Directed on purpose: shifting A's view of B says nothing about B's view of A,
 * which is what lets one wrestler carry a grudge the other never noticed
 * starting. Pass a number as shorthand for an affinity-only change.
 *
 * Emits nothing when nothing actually moved, so a clamped-out nudge does not
 * put a line in the log claiming something happened.
 */
export function adjustRelationship(fromId, toId, deltas, {
  reason = '', cause = null, type = '',
} = {}) {
  const state = requireGame();
  const from = requireWrestler(fromId);
  requireWrestler(toId);
  if (fromId === toId) throw new Error('A wrestler cannot hold a relationship with themselves');

  const rel = from.ties.relationships[toId] ||= createRelationship({}, state.calendar.day);
  const before = Object.fromEntries(AXES.map((a) => [a, rel[a]]));
  const patch = typeof deltas === 'number' ? { affinity: deltas } : deltas;

  const changed = applyDeltas(rel, patch, {
    day: state.calendar.day,
    summary: reason,
    type,
  });
  if (!Object.keys(changed).length) return rel;

  // This happened somewhere, between two people, and the GM was not
  // necessarily standing there. Everything else about the backstage layer
  // follows from marking it so.
  const souring = (changed.hostility || 0) > 0 || (changed.affinity || 0) < 0;
  const warming = (changed.affinity || 0) > 0 || (changed.trust || 0) > 0;
  const drift = souring ? 'souring on' : warming ? 'warming to' : 'reassessing';

  const event = emit(EVENT_TYPES.WRESTLER_RELATION, {
    summary: reason || `${from.name}'s view of ${nameOf(toId)} changed`,
    newsSummary: `${from.name} is ${drift} ${nameOf(toId)}`,
    actorId: fromId,
    subjects: [fromId, toId],
    cause,
    locationId: state.backstage.wrestlers[fromId] || 'locker_room',
    visibility: VISIBILITY.BACKSTAGE,
    data: { fromId, toId, before, after: Object.fromEntries(AXES.map((a) => [a, rel[a]])), changed, reason, type },
  });
  // Point the history entry at the event that caused it, so the full record is
  // one hop away even after the capped history rolls over.
  rel.history[rel.history.length - 1].eventId = event.id;
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
// Championships
// ---------------------------------------------------------------------------

export function createTitle(spec, { cause = null } = {}) {
  const state = requireGame();
  const title = makeTitle({ activatedOnDay: state.calendar.day, ...spec });
  state.titles[title.id] = title;
  emit(EVENT_TYPES.TITLE_CREATED, {
    summary: `${title.name} is introduced`,
    subjects: [title.id],
    cause,
    data: { tier: title.tier },
  });
  return title;
}

/**
 * Put the belt on someone. Closes the outgoing reign and opens a new one, so
 * the lineage is always a continuous chain with exactly one open link.
 */
export function awardTitle(titleId, wrestlerIds, {
  wonOnDay = null, atShowId = null, atSegmentId = null, reason = '', cause = null,
} = {}) {
  const state = requireGame();
  const title = requireTitle(titleId);
  for (const id of wrestlerIds) requireWrestler(id);

  const day = wonOnDay ?? state.calendar.day;
  const outgoing = currentReign(title);
  const previousIds = outgoing ? [...outgoing.wrestlerIds] : [];
  if (outgoing) outgoing.lostOnDay = day;

  title.lineage.push(createReign({
    wrestlerIds, wonOnDay: day, wonFromIds: previousIds, atShowId, atSegmentId,
  }));

  return emit(EVENT_TYPES.TITLE_WON, {
    summary: previousIds.length
      ? `${wrestlerIds.map(nameOf).join(' & ')} takes the ${title.shortName} title from ${previousIds.map(nameOf).join(' & ')}`
      : `${wrestlerIds.map(nameOf).join(' & ')} becomes ${title.shortName} champion`,
    subjects: [...wrestlerIds, ...previousIds, title.id],
    showId: atShowId, segmentId: atSegmentId,
    cause,
    data: { titleId, wrestlerIds, previousIds, day, reason, reignIndex: title.lineage.length - 1 },
  });
}

/** A successful defence. Counted on the reign, because that is what gets quoted. */
export function recordDefense(titleId, { againstIds = [], atShowId = null, atSegmentId = null, cause = null } = {}) {
  const title = requireTitle(titleId);
  const reign = currentReign(title);
  if (!reign) return null;
  reign.defenses += 1;

  return emit(EVENT_TYPES.TITLE_DEFENDED, {
    summary: `${reign.wrestlerIds.map(nameOf).join(' & ')} retains the ${title.shortName} title`,
    subjects: [...reign.wrestlerIds, ...againstIds, title.id],
    showId: atShowId, segmentId: atSegmentId,
    cause,
    data: { titleId, againstIds, defenses: reign.defenses },
  });
}

export function vacateTitle(titleId, { reason = '', cause = null } = {}) {
  const state = requireGame();
  const title = requireTitle(titleId);
  const reign = currentReign(title);
  if (!reign) return null;
  const held = [...reign.wrestlerIds];
  reign.lostOnDay = state.calendar.day;

  return emit(EVENT_TYPES.TITLE_VACATED, {
    summary: `The ${title.shortName} title is vacated`,
    subjects: [...held, title.id],
    cause,
    data: { titleId, previousIds: held, reason },
  });
}

/** Every title this wrestler currently holds. */
export function titlesHeldBy(wrestlerId) {
  return allTitles().filter((t) => championIds(t).includes(wrestlerId));
}

// ---------------------------------------------------------------------------
// What the roster is asking for
// ---------------------------------------------------------------------------

export function allRequests() {
  return Object.values(requireGame().requests);
}

export function openRequests() {
  return allRequests()
    .filter((r) => r.status === REQUEST_STATUS.OPEN)
    .sort((a, b) => b.urgency - a.urgency);
}

export function openRequestsFor(wrestlerId) {
  return openRequests().filter((r) => r.wrestlerId === wrestlerId);
}

/** Somebody asks for something. */
export function makeRequestFor(spec, { cause = null } = {}) {
  const state = requireGame();
  requireWrestler(spec.wrestlerId);
  const request = makeRequest({ day: state.calendar.day, ...spec });
  state.requests[request.id] = request;

  emit(EVENT_TYPES.REQUEST_MADE, {
    summary: request.text || `${nameOf(request.wrestlerId)} asks for ${REQUEST_LABEL[request.kind]}`,
    actorId: request.wrestlerId,
    subjects: [request.wrestlerId, request.targetId].filter(Boolean),
    cause,
    data: {
      requestId: request.id, kind: request.kind, urgency: request.urgency,
      targetId: request.targetId, titleId: request.titleId,
      reasons: request.reasons,
    },
  });
  return request;
}

/**
 * Close a request. `outcome` is granted, denied or ignored, and which one it
 * was matters more to the wrestler than what they asked for.
 */
export function resolveRequest(id, outcome, { segmentId = null, reason = '', cause = null } = {}) {
  const state = requireGame();
  const request = requireGame().requests[id];
  if (!request || request.status !== REQUEST_STATUS.OPEN) return null;

  request.status = outcome;
  request.resolvedOnDay = state.calendar.day;
  request.resolvedBySegmentId = segmentId;

  const type = {
    [REQUEST_STATUS.GRANTED]: EVENT_TYPES.REQUEST_GRANTED,
    [REQUEST_STATUS.DENIED]: EVENT_TYPES.REQUEST_DENIED,
    [REQUEST_STATUS.IGNORED]: EVENT_TYPES.REQUEST_IGNORED,
  }[outcome];
  if (!type) throw new Error(`resolveRequest: unknown outcome "${outcome}"`);

  return emit(type, {
    summary: reason || `${nameOf(request.wrestlerId)}: ${REQUEST_LABEL[request.kind]} ${outcome}`,
    actorId: request.wrestlerId,
    subjects: [request.wrestlerId, request.targetId].filter(Boolean),
    segmentId,
    cause,
    data: {
      requestId: request.id, kind: request.kind, outcome,
      targetId: request.targetId, titleId: request.titleId, urgency: request.urgency,
    },
  });
}

// ---------------------------------------------------------------------------
// Trouble
// ---------------------------------------------------------------------------

export function allIncidents() { return Object.values(requireGame().incidents); }
export function getIncident(id) { return requireGame().incidents[id] || null; }

export function requireIncident(id) {
  const incident = getIncident(id);
  if (!incident) throw new Error(`No incident with id ${id}`);
  return incident;
}

export function openIncidents() {
  return allIncidents()
    .filter((i) => i.status === INCIDENT_STATUS.OPEN)
    .sort((a, b) => b.severity - a.severity || a.tick - b.tick);
}

/** Open AND the GM has been told. The only ones they can actually answer. */
export function answerableIncidents() {
  return openIncidents().filter(isAnswerable);
}

export function incidentsAbout(wrestlerId) {
  return allIncidents().filter((i) => i.participantIds.includes(wrestlerId));
}

/**
 * Something goes wrong.
 *
 * The event is BACKSTAGE, so it goes through Tier 7's four questions like
 * anything else: if the GM is in the room they see it, and if they are not,
 * somebody has to be willing to come and find them. An incident nobody
 * mentions is one the GM will never answer, and that is the point.
 */
export function raiseIncident(spec, { cause = null } = {}) {
  const state = requireGame();
  for (const id of spec.participantIds || []) requireWrestler(id);

  const incident = createIncident({
    day: state.calendar.day,
    tick: state.backstage.tick,
    ...spec,
  });
  state.incidents[incident.id] = incident;

  const preset = INCIDENT_SPECS[incident.kind];
  const who = incident.participantIds.map(nameOf);
  const heard = incident.participantIds.length > 1
    ? `${who[0]} and ${who[1]} are having ${preset.noun}`
    : `${who[0]} is the subject of ${preset.noun}`;

  const event = emit(EVENT_TYPES.INCIDENT_STARTED, {
    summary: spec.summary || heard,
    newsSummary: spec.newsSummary || heard,
    actorId: incident.instigatorId,
    subjects: incident.participantIds,
    showId: incident.showId,
    segmentId: incident.segmentId,
    locationId: incident.locationId,
    // Almost everything backstage is backstage news, and goes through Tier 7's
    // four questions. A refusal is the exception: it stops the broadcast, and
    // dead air is not something anybody has to come and tell you about.
    visibility: spec.visibility || VISIBILITY.BACKSTAGE,
    cause,
    data: {
      incidentId: incident.id,
      kind: incident.kind,
      severity: incident.severity,
      severityLabel: severityLabel(incident.severity),
      reasons: incident.reasons,
    },
  });
  incident.startedEventId = event.id;
  incident.causeEventId = incident.causeEventId || cause || event.id;
  return incident;
}

/** The GM has been told. Until this happens they cannot answer it. */
export function discoverIncident(id, { notificationId = null } = {}) {
  const incident = getIncident(id);
  if (!incident || incident.discoveredTick != null) return incident || null;
  incident.discoveredTick = requireGame().backstage.tick;
  incident.notificationId = notificationId;
  return incident;
}

/** Close it, recording what the GM did and what came of it. */
export function resolveIncident(id, { response, landed = true, summary = '', effects = [], cause = null } = {}) {
  const state = requireGame();
  const incident = requireIncident(id);
  if (incident.status !== INCIDENT_STATUS.OPEN) return incident;

  incident.status = INCIDENT_STATUS.RESOLVED;
  incident.response = response;
  incident.respondedOnTick = state.backstage.tick;
  incident.outcome = { landed, summary, effects };

  emit(EVENT_TYPES.INCIDENT_RESOLVED, {
    summary: summary || `${incident.kind} settled`,
    subjects: incident.participantIds,
    showId: incident.showId,
    locationId: incident.locationId,
    cause: cause || incident.causeEventId,
    data: {
      incidentId: incident.id, kind: incident.kind, response,
      landed, severity: incident.severity, effects,
    },
  });
  return incident;
}

/** The night ended with it still open. Not the same as answering it. */
export function lapseIncident(id, { cause = null } = {}) {
  const incident = requireIncident(id);
  if (incident.status !== INCIDENT_STATUS.OPEN) return incident;
  incident.status = INCIDENT_STATUS.UNRESOLVED;

  emit(EVENT_TYPES.INCIDENT_LAPSED, {
    summary: `${INCIDENT_SPECS[incident.kind].label} left where it was`,
    subjects: incident.participantIds,
    showId: incident.showId,
    locationId: incident.locationId,
    cause: cause || incident.causeEventId,
    data: {
      incidentId: incident.id, kind: incident.kind,
      severity: incident.severity, knownToGm: incident.discoveredTick != null,
    },
  });
  return incident;
}

/** Record an attempt, so the same answer cannot be tried twice on one incident. */
export function noteAttempt(id, response) {
  const incident = requireIncident(id);
  if (!incident.attempted.includes(response)) incident.attempted.push(response);
  return incident;
}

/** A refusal stops the match it is a refusal of, until somebody deals with it. */
export function blockSegment(segmentId, incidentId) {
  const segment = requireSegment(segmentId);
  segment.blockedByIncidentId = incidentId;
  return segment;
}

export function unblockSegment(segmentId) {
  const segment = requireSegment(segmentId);
  segment.blockedByIncidentId = null;
  return segment;
}

/** What the office has had to do about somebody. */
export function setDiscipline(id, patch, { reason = '', cause = null } = {}) {
  const wrestler = requireWrestler(id);
  const before = { ...wrestler.state.discipline };
  Object.assign(wrestler.state.discipline, patch);

  emit(EVENT_TYPES.WRESTLER_DISCIPLINE, {
    summary: reason || `${wrestler.name}'s standing with the office changed`,
    actorId: id,
    subjects: [id],
    cause,
    data: { before, after: { ...wrestler.state.discipline }, patch },
  });
  return wrestler.state.discipline;
}

// ---------------------------------------------------------------------------
// Factions and reactions
// ---------------------------------------------------------------------------

export function allFactions() { return Object.values(requireGame().factions); }
export function getFaction(id) { return requireGame().factions[id] || null; }

/** The stable somebody runs with, or null. Nobody is in two. */
export function factionOf(wrestlerId) {
  return allFactions().find((f) => factionIsActive(f) && f.memberIds.includes(wrestlerId)) || null;
}

export function sameFaction(aId, bId) {
  const f = factionOf(aId);
  return !!f && f.memberIds.includes(bId);
}

export function formFaction(spec, { cause = null } = {}) {
  const state = requireGame();
  for (const id of spec.memberIds || []) requireWrestler(id);
  const faction = createFaction({ formedOnDay: state.calendar.day, ...spec });
  state.factions[faction.id] = faction;

  emit(EVENT_TYPES.FACTION_FORMED, {
    summary: `${faction.name}: ${faction.memberIds.map(nameOf).join(', ')}`,
    subjects: faction.memberIds,
    cause,
    data: { factionId: faction.id, leaderId: faction.leaderId, memberIds: faction.memberIds },
  });
  return faction;
}

/**
 * Record what somebody did, or decided not to do, about an incident.
 *
 * Reactions live on the incident rather than in a registry of their own,
 * because a reaction with no incident is meaningless and one that outlived its
 * incident would be a dangling reference waiting to happen.
 */
export function addReaction(incidentId, spec, { cause = null } = {}) {
  const state = requireGame();
  const incident = requireIncident(incidentId);
  requireWrestler(spec.wrestlerId);
  const reaction = createReaction({
    incidentId,
    raisedTick: incident.tick,
    dueTick: state.backstage.tick,
    ...spec,
  });
  incident.reactions.push(reaction);
  if (reaction.dueTick > state.backstage.tick) state.pendingReactions.push(reaction.id);
  return reaction;
}

export function findReaction(id) {
  for (const incident of allIncidents()) {
    const found = incident.reactions.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

/** Reactions decided but not yet acted on, soonest first. */
export function pendingReactions() {
  return requireGame().pendingReactions
    .map(findReaction)
    .filter(Boolean)
    .sort((a, b) => a.dueTick - b.dueTick);
}

/** Everything whose moment has come. The caller decides what each one does. */
export function dueReactions() {
  const now = requireGame().backstage.tick;
  return pendingReactions().filter((r) => r.dueTick <= now);
}

/** Mark one as having happened, and take it off the queue. */
export function commitReaction(reactionId, { spawnedIncidentId = null } = {}) {
  const state = requireGame();
  const reaction = findReaction(reactionId);
  if (!reaction || reaction.tick != null) return reaction || null;
  reaction.tick = state.backstage.tick;
  reaction.spawnedIncidentId = spawnedIncidentId;
  state.pendingReactions = state.pendingReactions.filter((id) => id !== reactionId);
  return reaction;
}

/** Drop anything still queued. Used when the night ends. */
export function clearPendingReactions() {
  const state = requireGame();
  const dropped = state.pendingReactions.length;
  state.pendingReactions = [];
  return dropped;
}

/** A join makes the same fight worse rather than starting a new one. */
export function raiseSeverity(incidentId, by, { reason = '', cause = null } = {}) {
  const incident = requireIncident(incidentId);
  const before = incident.severity;
  incident.severity = Math.max(1, Math.min(100, Math.round(before + by)));
  if (incident.severity === before) return incident;

  emit(EVENT_TYPES.INCIDENT_ESCALATED, {
    summary: reason || `${INCIDENT_SPECS[incident.kind].label} is getting worse`,
    subjects: incident.participantIds,
    showId: incident.showId,
    locationId: incident.locationId,
    visibility: VISIBILITY.BACKSTAGE,
    cause: cause || incident.startedEventId,
    data: {
      incidentId, from: before, to: incident.severity,
      severityLabel: severityLabel(incident.severity),
    },
  });
  return incident;
}

/** Pull somebody into an incident that is already running. */
export function addParticipant(incidentId, wrestlerId) {
  const incident = requireIncident(incidentId);
  requireWrestler(wrestlerId);
  if (!incident.participantIds.includes(wrestlerId)) incident.participantIds.push(wrestlerId);
  return incident;
}

/** Walk a chain back to the thing that started it. */
export function incidentChain(incidentId) {
  const chain = [];
  let current = getIncident(incidentId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.causeIncidentId ? getIncident(current.causeIncidentId) : null;
  }
  return chain;
}

/** Everything that came out of this one, depth first. */
export function incidentsCausedBy(incidentId) {
  return allIncidents().filter((i) => i.causeIncidentId === incidentId);
}

// ---------------------------------------------------------------------------
// The backstage
// ---------------------------------------------------------------------------

export function backstage() { return requireGame().backstage; }
export function gmLocation() { return requireGame().backstage.gmLocation; }
export function tick() { return requireGame().backstage.tick; }

export function locationOf(wrestlerId) {
  return requireGame().backstage.wrestlers[wrestlerId] || 'locker_room';
}

/** Everybody currently in a room. */
export function whoIsIn(locationId) {
  const b = requireGame().backstage;
  return allWrestlers().filter((w) => (b.wrestlers[w.id] || 'locker_room') === locationId);
}

/** Put somebody in a room. Quiet by default: people move constantly. */
export function placeWrestler(wrestlerId, locationId, { reason = '', cause = null, silent = true } = {}) {
  const state = requireGame();
  requireWrestler(wrestlerId);
  if (!isLocation(locationId)) throw new Error(`Unknown location "${locationId}"`);
  const before = state.backstage.wrestlers[wrestlerId] || null;
  if (before === locationId) return locationId;
  state.backstage.wrestlers[wrestlerId] = locationId;

  if (!silent) {
    emit(EVENT_TYPES.WRESTLER_MOVED, {
      summary: reason || `${nameOf(wrestlerId)} goes to ${locationName(locationId)}`,
      actorId: wrestlerId,
      subjects: [wrestlerId],
      locationId,
      visibility: VISIBILITY.BACKSTAGE,
      cause,
      data: { from: before, to: locationId },
    });
  }
  return locationId;
}

/**
 * Walk the GM somewhere. Costs time, which is the whole point: while you are
 * crossing the building, the building is carrying on without you.
 */
export function moveGm(locationId, { cause = null } = {}) {
  const state = requireGame();
  if (!isLocation(locationId)) throw new Error(`Unknown location "${locationId}"`);
  const from = state.backstage.gmLocation;
  if (from === locationId) return { from, to: locationId, seconds: 0 };

  const seconds = travelSeconds(from, locationId);
  state.backstage.tick += seconds;
  state.backstage.gmLocation = locationId;

  const via = route(from, locationId);
  const event = emit(EVENT_TYPES.GM_MOVED, {
    summary: `You walk to ${locationName(locationId)}`,
    cause,
    locationId,
    data: { from, to: locationId, seconds, via },
  });
  return { from, to: locationId, seconds, via, event };
}

/** Move the night along without walking anywhere. */
export function advanceTick(seconds) {
  const state = requireGame();
  if (seconds > 0) state.backstage.tick += Math.round(seconds);
  return state.backstage.tick;
}

/** Reset the clock and clear the floor, at the top of a new night. */
export function resetBackstageClock() {
  const state = requireGame();
  state.backstage.tick = 0;
  return state.backstage.tick;
}

// --- notifications ---

export function notifications() { return requireGame().backstage.notifications; }

export function pendingNotifications() {
  return notifications().filter((n) => n.deliveredTick == null);
}

export function deliveredNotifications() {
  return notifications().filter((n) => n.deliveredTick != null);
}

export function unreadNotifications() {
  return deliveredNotifications().filter((n) => !n.read);
}

/** How many notifications a save keeps before the oldest read ones are dropped. */
export const NOTIFICATION_LIMIT = 120;

/** Queue news to reach the GM at some future tick. */
export function scheduleNotification(spec, { cause = null } = {}) {
  const state = requireGame();
  const note = createNotification({ raisedTick: state.backstage.tick, ...spec });
  state.backstage.notifications.push(note);
  trimNotifications(state);
  return note;
}

/**
 * Keep the list to its cap, oldest read news first.
 *
 * Preferring to drop what the GM has already seen is the right instinct, but a
 * cap that only ever drops read news is not a cap: a quiet GM who reads nothing
 * would grow the save without limit. So once the read ones are gone, the oldest
 * of anything goes too.
 */
function trimNotifications(state) {
  const list = state.backstage.notifications;
  let over = list.length - NOTIFICATION_LIMIT;
  if (over <= 0) return;

  const oldestFirst = [...list].sort((a, b) => a.raisedTick - b.raisedTick);
  const doomed = new Set();
  for (const pass of [(n) => n.deliveredTick != null && n.read, () => true]) {
    for (const n of oldestFirst) {
      if (over <= 0) break;
      if (doomed.has(n.id) || !pass(n)) continue;
      doomed.add(n.id);
      over--;
    }
  }
  state.backstage.notifications = list.filter((n) => !doomed.has(n.id));
}

/** Deliver everything whose time has come. Returns what just landed. */
export function deliverDueNotifications({ cause = null } = {}) {
  const state = requireGame();
  const now = state.backstage.tick;
  const landed = [];

  for (const note of state.backstage.notifications) {
    if (note.deliveredTick != null || note.dueTick > now) continue;
    note.deliveredTick = now;
    landed.push(note);

    emit(EVENT_TYPES.NEWS_REACHED_GM, {
      summary: note.summary,
      subjects: note.aboutIds,
      locationId: note.locationId,
      cause: cause || note.eventId,
      data: {
        notificationId: note.id,
        eventId: note.eventId,
        reliability: note.reliability,
        sourceWrestlerId: note.sourceWrestlerId,
        lateBySec: Math.max(0, now - note.raisedTick),
      },
    });
  }
  return landed;
}

export function markNotificationRead(id) {
  const note = requireGame().backstage.notifications.find((n) => n.id === id);
  if (note) note.read = true;
  return note;
}

/** Raise or lower how well wired-in the GM is. The skill tree's hook. */
export function setBackstageAwareness(value) {
  const state = requireGame();
  state.meta.backstageAwareness = Math.max(0, Math.min(100, Math.round(value)));
  return state.meta.backstageAwareness;
}

export function markAllNotificationsRead() {
  for (const n of deliveredNotifications()) n.read = true;
}

// ---------------------------------------------------------------------------
// Log reads
// ---------------------------------------------------------------------------

export function queryLog(opts) { return events.query(requireGame().log, opts); }
export function getEvent(id) { return requireGame().log.find((e) => e.id === id) || null; }
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

  for (const [otherId, seed] of Object.entries(relationships)) {
    requireWrestler(otherId);
    if (otherId === id) throw new Error(`${id} cannot hold a relationship with themselves`);
    w.ties.relationships[otherId] = createRelationship(seed, state.calendar.day);
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
