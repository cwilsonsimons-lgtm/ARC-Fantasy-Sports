// Who is standing where, and what that costs.
//
// The building fills up before a show and empties as the night runs. Wrestlers
// are placed by what they are doing and who they are: the sociable ones drift
// to catering, somebody who just took a beating ends up in medical, whoever is
// working next is at the curtain.
//
// The GM is somewhere too, and that is the point of the whole layer. They can
// only be in one room, walking between rooms costs time, and anything that
// happens while they are elsewhere has to reach them somehow.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { LOCATION_IDS, isLocation } from '../models/location.js';
import { SEGMENT_STATUS } from '../models/segment.js';
import { HEALTH } from '../models/wrestler.js';

/** Where somebody with nothing to do tends to wait. */
function idleRoomFor(wrestler, rng) {
  const t = wrestler.identity.traits;
  return rng.weighted([
    ['locker_room', 40],
    ['catering', 10 + t.sociability * 0.5],
    ['hallway', 10 + t.sociability * 0.2],
    ['parking', 6 + (100 - t.sociability) * 0.15],
    ['gm_office', 2 + wrestler.identity.ego * 0.08],
  ]) || 'locker_room';
}

/** Where somebody who is working tonight waits. Mostly, but not only, the
 *  locker room - a building where everyone stands in one room is a dead one. */
function bookedRoomFor(wrestler, rng) {
  const t = wrestler.identity.traits;
  return rng.weighted([
    ['locker_room', 55],
    ['catering', 12 + t.sociability * 0.2],
    ['hallway', 10],
    ['interview_area', 5 + wrestler.ability.charisma * 0.12],
    ['production', 4],
    ['gm_office', 2 + wrestler.identity.ego * 0.06],
  ]) || 'locker_room';
}

/**
 * Fill the building at the top of a night.
 *
 * Whoever is on first is already at the curtain; everyone else working tonight
 * is near the action; everyone not booked is wherever people go when nobody has
 * given them a reason to be anywhere.
 */
export function openDoors(showId, { cause = null } = {}) {
  const rng = store.getRng();
  const show = store.getShow(showId);
  const segments = show ? store.segmentsOfShow(show.id) : [];
  const booked = new Set(
    segments.flatMap((seg) => seg.participants.map((p) => p.wrestlerId))
  );

  store.resetBackstageClock();
  for (const w of store.allWrestlers()) {
    if (w.state.health.status === HEALTH.INJURED) {
      store.placeWrestler(w.id, 'medical', { cause });
      continue;
    }
    store.placeWrestler(w.id, booked.has(w.id)
      ? bookedRoomFor(w, rng)
      : idleRoomFor(w, rng), { cause });
  }

  // Whoever opens the show is already standing at the curtain.
  if (segments[0]) callToGorilla(segments[0].id, { cause });
  return store.backstage();
}

/** Bring whoever is on next up to the curtain. */
export function callToGorilla(segmentId, { cause = null } = {}) {
  const segment = store.getSegment(segmentId);
  if (!segment) return;
  for (const p of segment.participants) {
    store.placeWrestler(p.wrestlerId, 'gorilla', { cause });
  }
}

/** Where somebody goes once their segment is over. */
function afterWorking(wrestler, rng) {
  if (wrestler.state.health.status === HEALTH.INJURED) return 'medical';
  if (wrestler.state.condition < 45) return rng.chance(0.5) ? 'medical' : 'locker_room';
  return rng.weighted([
    ['locker_room', 55],
    ['interview_area', 10 + wrestler.ability.charisma * 0.2],
    ['catering', 12 + wrestler.identity.traits.sociability * 0.25],
    ['hallway', 10],
    ['gm_office', 3 + wrestler.identity.ego * 0.1],
  ]) || 'locker_room';
}

export function install() {
  // Going on the air fills the building and starts the clock.
  store.on(EVENT_TYPES.SHOW_STARTED, (event) => {
    openDoors(event.showId, { cause: event.id });
  });

  // A segment running is the clock moving, and people moving with it.
  store.on(EVENT_TYPES.SEGMENT_COMPLETED, (event) => {
    const segment = store.getSegment(event.segmentId);
    if (!segment) return;
    const rng = store.getRng();

    store.advanceTick(event.data.actualSec || 0);
    for (const p of segment.participants) {
      const w = store.getWrestler(p.wrestlerId);
      if (w) store.placeWrestler(w.id, afterWorking(w, rng), { cause: event.id });
    }

    // Whoever is on next heads for the curtain.
    const next = store.segmentsOfShow(segment.showId)
      .find((s) => s.status === SEGMENT_STATUS.BOOKED);
    if (next) callToGorilla(next.id, { cause: event.id });

    store.deliverDueNotifications({ cause: event.id });
  });

  // Walking somewhere takes time, and news may be waiting when you arrive.
  store.on(EVENT_TYPES.GM_MOVED, (event) => {
    store.deliverDueNotifications({ cause: event.id });
  });

  // Between shows everybody scatters and the clock resets.
  store.on(EVENT_TYPES.SHOW_COMPLETED, (event) => {
    const rng = store.getRng();
    for (const w of store.allWrestlers()) {
      store.placeWrestler(w.id, w.state.health.status === HEALTH.INJURED
        ? 'medical' : idleRoomFor(w, rng), { cause: event.id });
    }
    store.advanceTick(600);                       // the building empties out
    store.deliverDueNotifications({ cause: event.id });
  });
}

export { LOCATION_IDS, isLocation };
