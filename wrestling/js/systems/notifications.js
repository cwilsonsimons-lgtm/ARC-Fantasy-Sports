// How the GM finds out.
//
// An event happening and the GM knowing about it are two different things. This
// is the second one, and it is the heart of the backstage layer.
//
// Four questions, in order:
//
//   1. Was the GM in the room? Then they saw it, now, correctly.
//   2. Was anybody else in the room? If nobody was, nobody can tell them, and
//      the news is simply lost.
//   3. Would any of those people tell the GM? Somebody who neither trusts them
//      nor talks to anybody keeps it to themselves.
//   4. How long does it take, and how much survives the trip?
//
// `state.meta.backstageAwareness` is the hook the GM skill tree will hang off:
// raising it shortens every delay and pushes reliability up. It is 0 today.

import * as store from '../core/store.js';
import { EVENT_TYPES, VISIBILITY } from '../core/events.js';
import { hops, locationName } from '../models/location.js';
import { RELIABILITY } from '../models/notification.js';

/** Baseline lag before news even starts travelling, in seconds. */
export const BASE_DELAY_SEC = 90;
/** Added per doorway between where it happened and where the GM was. */
export const DELAY_PER_HOP_SEC = 110;

/** How much of the delay a fully-upgraded GM could cut. */
export const MAX_AWARENESS_CUT = 0.6;

export function awareness() {
  return Math.max(0, Math.min(100, store.getState()?.meta.backstageAwareness ?? 0));
}

/**
 * How willing somebody is to bring the GM news, 0-100.
 * You have to both talk to people and think the office is worth talking to.
 */
export function willingnessToTell(wrestler) {
  const t = wrestler.identity.traits;
  return Math.round(
    wrestler.ties.gm.trust * 0.45
    + t.sociability * 0.35
    + wrestler.ties.gm.respect * 0.2
  );
}

/** Below this, nobody bothers finding the GM. */
export const TELL_THRESHOLD = 32;

/** Whoever in the room is most likely to come and find you. */
export function bestTeller(locationId, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  return store.whoIsIn(locationId)
    .filter((w) => !skip.has(w.id))
    .map((w) => ({ w, willingness: willingnessToTell(w) }))
    .sort((a, b) => b.willingness - a.willingness)[0] || null;
}

/**
 * What the GM is actually told.
 *
 * `newsSummary` is the line written to be heard; the log's own summary is
 * written to be read and often reads as a fragment out loud. Prefer the former
 * and only fall back when an event has not supplied one.
 */
function spoken(event) {
  return event.newsSummary || event.summary;
}

/** Vaguer the further it has travelled. */
function hedge(line, reliability) {
  switch (reliability) {
    case RELIABILITY.WITNESSED:
    case RELIABILITY.FIRSTHAND:
      return line;
    case RELIABILITY.SECONDHAND:
      return `You hear that ${lowerLead(line)}`;
    default:
      return `Word going round is that ${lowerLead(line)}`;
  }
}

/**
 * Fold a line into the middle of a sentence.
 *
 * Most news opens on somebody's name, and a name keeps its capital wherever it
 * sits: "You hear that Damien Croft is souring on Ruby Vance" is right, and
 * "you hear that damien Croft" is worse than the problem lowercasing solves.
 * So only a word that is nobody's name gets folded down.
 */
function lowerLead(line) {
  if (!line) return line;
  const lead = line.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
  if (isSomebodysName(lead)) return line;
  return line[0].toLowerCase() + line.slice(1);
}

function isSomebodysName(word) {
  if (!word) return false;
  const state = store.getState();
  if (!state) return false;
  return Object.values(state.wrestlers)
    .some((w) => w.name.split(/\s+/).includes(word));
}

/**
 * Work out what the GM learns of one backstage event, and when.
 * Returns the notification, or null when the news never reaches them.
 */
export function report(event, { cause = null } = {}) {
  if (event.visibility !== VISIBILITY.BACKSTAGE) return null;
  const where = event.locationId;
  if (!where) return null;

  const gmWhere = store.gmLocation();

  // 1. In the room. No delay, no distortion, no middleman.
  if (where === gmWhere) {
    const note = store.scheduleNotification({
      eventId: event.id,
      locationId: where,
      aboutIds: event.subjects,
      reliability: RELIABILITY.WITNESSED,
      sourceWrestlerId: null,
      dueTick: store.tick(),
      summary: spoken(event),
      detail: `You were in ${locationName(where)} when it happened.`,
    }, { cause });
    store.deliverDueNotifications({ cause: cause || event.id });
    return note;
  }

  // 2. Nobody there to see it. It simply does not reach you.
  const teller = bestTeller(where);
  if (!teller) {
    store.emit(EVENT_TYPES.NEWS_MISSED, {
      summary: `Something happened in ${locationName(where)} with nobody around to mention it`,
      subjects: event.subjects,
      locationId: where,
      cause: cause || event.id,
      data: { eventId: event.id, reason: 'no_witnesses' },
    });
    return null;
  }

  // 3. Somebody was there, but not everybody talks to the office.
  if (teller.willingness < TELL_THRESHOLD) {
    store.emit(EVENT_TYPES.NEWS_MISSED, {
      summary: `Whatever happened in ${locationName(where)}, nobody is telling you`,
      subjects: event.subjects,
      locationId: where,
      cause: cause || event.id,
      data: {
        eventId: event.id, reason: 'nobody_would_tell',
        closestTeller: teller.w.id, willingness: teller.willingness,
      },
    });
    return null;
  }

  // 4. It travels. Distance costs time; distance and a reluctant source cost
  //    accuracy.
  //
  //    Distance standing in for accuracy is an abstraction: the person who was
  //    in the room is not necessarily the person who finds you, so the further
  //    the news has come the more mouths it has passed through. The exception is
  //    somebody the news is about. They cannot be second hand on themselves,
  //    however far they walked to say it.
  const distance = hops(where, gmWhere);
  const cut = 1 - (awareness() / 100) * MAX_AWARENESS_CUT;
  const delay = Math.round((BASE_DELAY_SEC + distance * DELAY_PER_HOP_SEC) * cut);

  const itsAboutThem = (event.subjects || []).includes(teller.w.id);
  const reliability = itsAboutThem || (distance <= 1 && teller.willingness >= 55)
    ? RELIABILITY.FIRSTHAND
    : teller.willingness >= 45
      ? RELIABILITY.SECONDHAND
      : RELIABILITY.RUMOUR;

  return store.scheduleNotification({
    eventId: event.id,
    locationId: where,
    aboutIds: event.subjects,
    reliability,
    sourceWrestlerId: teller.w.id,
    dueTick: store.tick() + delay,
    summary: hedge(spoken(event), reliability),
    detail: itsAboutThem
      ? `${teller.w.name} came and told you themselves, from ${locationName(where)}.`
      : `It started in ${locationName(where)}, ${distance} door${distance === 1 ? '' : 's'} from you, and reached you through ${teller.w.name}.`,
  }, { cause });
}

export function install() {
  // Everything that happens in a room goes through the same four questions.
  store.on('*', (event) => {
    if (event.visibility !== VISIBILITY.BACKSTAGE) return;
    if (event.type === EVENT_TYPES.NEWS_REACHED_GM || event.type === EVENT_TYPES.NEWS_MISSED) return;
    report(event, { cause: event.id });
  });
}
