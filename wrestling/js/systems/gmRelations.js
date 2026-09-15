// What the GM's decisions do to the GM.
//
// The design foundation is insistent that the GM is a character in the world
// rather than a cursor, and this is where that becomes true in the data. Trust
// and respect are tracked separately because they are separately earned: trust
// is whether they believe what you say, respect is whether they rate you at the
// job. You can have one without the other, and the two are damaged by different
// things.
//
// Everything here comes off decisions the GM already makes. Nobody is invented
// a grievance: they are cut from a show, passed over for a title shot, or left
// off television, and they notice.

import * as store from '../core/store.js';
import { EVENT_TYPES } from '../core/events.js';
import { SEGMENT_KINDS } from '../models/segment.js';
import { CAREER_RANK, statusRank } from '../models/wrestler.js';
import { MEMORY_TYPES } from '../models/memory.js';
import { championIds } from '../models/title.js';

/** How much a slight lands, given who it happened to. */
function sting(wrestler) {
  const status = statusRank(wrestler) / 6;         // 0 rookie .. 1 superstar
  const ego = wrestler.identity.ego / 100;
  const ambition = wrestler.identity.ambition / 100;
  return 0.35 + status * 0.8 + ego * 0.5 + ambition * 0.35;
}

/** Completed shows, newest first. */
function completedShows() {
  return store.allShows()
    .filter((s) => s.status === 'complete')
    .sort((a, b) => b.day - a.day);
}

function appearedOn(show, wrestlerId) {
  return show.segmentIds.some((id) =>
    store.getSegment(id)?.participants.some((p) => p.wrestlerId === wrestlerId));
}

/** How many completed shows in a row they have missed, most recent first. */
function consecutiveMisses(wrestlerId) {
  let n = 0;
  for (const show of completedShows()) {
    if (appearedOn(show, wrestlerId)) break;
    n++;
    if (n > 12) break;
  }
  return n;
}

/** Being cut is worse than never being booked: they were told, then untold. */
function onSegmentCut(event) {
  const segment = store.getSegment(event.segmentId);
  if (!segment) return;
  const show = store.getShow(segment.showId);

  for (const p of segment.participants) {
    const w = store.getWrestler(p.wrestlerId);
    if (!w) continue;
    const weight = sting(w);

    store.adjustGmTie(w.id, {
      trust: -Math.round(5 * weight),
      respect: -Math.round(3 * weight),
    }, { reason: 'Cut from the card after being booked', cause: event.id });

    store.updateWrestlerState(w.id, {
      morale: w.state.morale - 4 * weight,
      mood: w.identity.ego > 65 ? 'frustrated' : w.state.mood,
    }, { reason: 'Cut from the card', cause: event.id });

    store.addMemory(w.id, {
      type: MEMORY_TYPES.CUT_FROM_SHOW.key,
      summary: `Booked on ${show?.name || 'the show'} and then cut from it`,
      aboutIds: [],
    }, { cause: event.id });
  }
}

/**
 * A title shot is the single most valuable thing the GM can hand out, so it is
 * also the loudest statement about who is being passed over.
 */
function onSegmentBooked(event) {
  const segment = store.getSegment(event.segmentId);
  if (!segment || !segment.titleId || segment.kind !== SEGMENT_KINDS.MATCH) return;
  const title = store.getTitle(segment.titleId);
  if (!title) return;

  const holders = new Set(championIds(title));
  const inMatch = segment.participants.map((p) => p.wrestlerId);

  // Whoever got the shot knows what it is worth.
  for (const id of inMatch) {
    if (holders.has(id)) continue;
    const w = store.getWrestler(id);
    if (!w) continue;
    store.adjustGmTie(id, { trust: 7, respect: 6 }, {
      reason: `Given a shot at the ${title.shortName} title`, cause: event.id,
    });
    store.updateWrestlerState(id, {
      morale: w.state.morale + 7, mood: 'confident',
    }, { reason: 'Given a title shot', cause: event.id });
    store.addMemory(id, {
      type: MEMORY_TYPES.TITLE_SHOT.key,
      summary: `Given a shot at the ${title.shortName} title`,
      aboutIds: holders.size ? [...holders] : [],
    }, { cause: event.id });
  }

  // And whoever the rankings said should have got it knows that too.
  const contenderId = title.contenderId;
  if (!contenderId || inMatch.includes(contenderId) || holders.has(contenderId)) return;

  const c = store.getWrestler(contenderId);
  if (!c) return;
  const weight = sting(c);
  const takenBy = inMatch.filter((id) => !holders.has(id));

  store.adjustGmTie(contenderId, {
    trust: -Math.round(9 * weight),
    respect: -Math.round(5 * weight),
  }, { reason: `Passed over for the ${title.shortName} title shot`, cause: event.id });

  store.updateWrestlerState(contenderId, {
    morale: c.state.morale - 7 * weight,
    mood: 'frustrated',
  }, { reason: 'Passed over for a title shot', cause: event.id });

  store.addMemory(contenderId, {
    type: MEMORY_TYPES.TITLE_SHOT_DENIED.key,
    summary: takenBy.length
      ? `Ranked #${c.standing.rank} and watched ${takenBy.map(store.nameOf).join(' and ')} get the ${title.shortName} title shot`
      : `Ranked #${c.standing.rank} and passed over for the ${title.shortName} title shot`,
    aboutIds: takenBy,
  }, { cause: event.id });

  // Jealousy points at the person who got it, not only at the office.
  for (const id of takenBy) {
    store.adjustRelationship(contenderId, id, {
      hostility: 10 * (0.5 + c.identity.traits.jealousy / 100),
      affinity: -6 * (0.5 + c.identity.traits.jealousy / 100),
    }, {
      type: MEMORY_TYPES.TITLE_SHOT_DENIED.key,
      reason: `${store.nameOf(id)} got the title shot they believed was theirs`,
      cause: event.id,
    });
  }
}

/** Not being on television at all is a slower, quieter kind of insult. */
function onShowCompleted(event) {
  const show = store.getShow(event.showId);
  if (!show) return;

  for (const w of store.allWrestlers()) {
    if (appearedOn(show, w.id)) continue;
    const missed = consecutiveMisses(w.id);
    // Capped, because this fires every single week a wrestler is off the card.
    // Uncapped it drove a superstar's respect to zero inside five weeks, which
    // would poison every judgement built on top of it.
    const weight = Math.min(4, sting(w) * Math.min(3, missed));
    if (weight < 1.2) continue;   // a rookie missing one week does not care

    store.adjustGmTie(w.id, { respect: -Math.round(1.5 * weight) }, {
      reason: `Left off ${show.name}`, cause: event.id,
    });
    store.updateWrestlerState(w.id, {
      morale: w.state.morale - 1.5 * weight,
    }, { reason: 'Left off the show', cause: event.id, silent: true });

    // Only worth remembering once it is a pattern rather than a week off.
    if (missed >= 2) {
      store.addMemory(w.id, {
        type: MEMORY_TYPES.OVERLOOKED.key,
        summary: `Left off television ${missed} shows running`,
        aboutIds: [],
      }, { cause: event.id });
    }
  }
}

export function install() {
  store.on(EVENT_TYPES.SEGMENT_CUT, onSegmentCut);
  store.on(EVENT_TYPES.SEGMENT_BOOKED, onSegmentBooked);
  store.on(EVENT_TYPES.SHOW_COMPLETED, onShowCompleted);
}
