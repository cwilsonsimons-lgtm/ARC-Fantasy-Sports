// How a show changes the locker room.
//
// Morale needs a cause, and the only honest cause available today is who was
// used and who was not — there is no incident system yet, so nothing invents a
// grievance out of nothing. What the show can say is:
//
//   you appeared, and where on the card, and for how long
//   you did not appear, again, for the Nth week running
//
// Repetition is what matters. One missed week is a slight; three in a row
// becomes a belief, and that is when a grudge forms. Injured and unavailable
// wrestlers are exempt — they could not have been booked, so being left off is
// not a snub.
//
// Every number below is placeholder tuning, deliberately legible rather than
// balanced.
import { airedItems, elapsedMinutes } from './broadcast.js';
import { createEntry } from './journal.js';
import { growFamiliarity } from './stats.js';
import { noteItem } from './relationships.js';
import { tasteOf } from './match-types.js';
import { nextId } from '../ids.js';

const APPEARED_BASE = 2;
const MAIN_EVENT_BONUS = 4;
const OPENER_BONUS = 1;
const MINUTES_PER_POINT = 5;
const MISSED_BASE = 2;
const MISSED_PER_WEEK = 2;
const MISSED_WEEKS_CAP = 4;
const GRUDGE_AT_WEEKS = 3;
// Being put in a match you genuinely dread does not need repeating to land.
const HATED_TASTE = 20;

export const MORALE_MIN = 0;
export const MORALE_MAX = 100;

// What each wrestler actually got out of the show that just aired. Built from
// what aired, not from what was planned.
export function involvement(state) {
  const { show, broadcast } = state;
  const byWrestler = new Map();
  const lastIndex = show.items.length - 1;

  for (const { item, result } of airedItems(show, broadcast)) {
    if (!item) continue;
    const index = show.items.indexOf(item);
    for (const id of item.participants) {
      const entry = byWrestler.get(id)
        || { minutes: 0, segmentMinutes: 0, items: 0, mainEvent: false, opener: false, stipulations: [] };
      entry.minutes += result.actualMinutes;
      if (item.type === 'segment') entry.segmentMinutes += result.actualMinutes;
      else entry.stipulations.push(item.matchType);
      entry.items += 1;
      if (index === lastIndex) entry.mainEvent = true;
      if (index === 0) entry.opener = true;
      byWrestler.set(id, entry);
    }
  }
  return byWrestler;
}

function bookable(wrestler) {
  return wrestler.status === 'Available';
}

function clamp(n) {
  if (!Number.isFinite(n)) return 50;
  return Math.max(MORALE_MIN, Math.min(MORALE_MAX, Math.round(n)));
}

// Applied once, when the show comes off the air.
// Half-range swing around the midpoint: 50 gives 0, 100 gives +size, 0 gives -size.
function swing(value, size) {
  return Math.round(((value - 50) / 50) * size);
}

// Professionalism flattens a reaction in both directions. A pro takes good news
// and bad news at roughly the same temperature.
function temper(wrestler, delta) {
  const factor = 1 - (wrestler.stats.professionalism - 50) / 200; // 0.75x .. 1.25x
  return Math.round(delta * factor);
}

export function settleShow(state) {
  const appearances = involvement(state);
  const at = elapsedMinutes(state.broadcast);
  const newGrudges = [];
  const hatedBookings = [];

  // History first: who met whom in the ring, and who stood beside whom.
  for (const { item } of airedItems(state.show, state.broadcast)) {
    if (item) noteItem(state.wrestlers, item);
  }

  for (const wrestler of state.wrestlers) {
    const used = appearances.get(wrestler.id);
    // You learn people by being around them, and faster by working with them.
    growFamiliarity(wrestler, Boolean(used));

    if (used) {
      wrestler.weeksOffCard = 0;
      let delta = APPEARED_BASE
        + (used.mainEvent ? MAIN_EVENT_BONUS : 0)
        + (used.opener ? OPENER_BONUS : 0)
        + Math.floor(used.minutes / MINUTES_PER_POINT);

      // Ego decides how much the size of the spot matters: the marquee slot is
      // worth more to a big one, and opening the show stings.
      if (used.mainEvent) delta += swing(wrestler.stats.ego, 3);
      else if (used.opener) delta -= swing(wrestler.stats.ego, 2);

      // Talkers get more out of microphone time than wrestlers do.
      if (used.segmentMinutes) {
        delta += Math.round((used.segmentMinutes / 10) * (wrestler.stats.charisma / 60));
      }

      // What they were asked to do, not just how much of it. Getting the match
      // you have been asking for is worth as much as the spot itself; being put
      // in the one you dread costs more.
      for (const stipulation of used.stipulations) {
        const taste = tasteOf(wrestler, stipulation);
        // Taste scales the whole booking rather than nudging it. A wrestler who
        // dreads the stipulation does not enjoy the main event much either, so
        // the spot is worth a fraction of what it would otherwise have been —
        // and then the stipulation lands on top of that.
        delta *= 0.5 + taste / 100;          // hated 0.5x, indifferent 1x, loved 1.5x
        delta += Math.round((taste - 50) / 4); // and its own weight, -12 .. +12
        if (taste < HATED_TASTE && !hasMatchGrudge(wrestler, stipulation)) {
          wrestler.grudges.push({
            id: nextId('gr'),
            week: state.week,
            type: 'hated-match',
            targetId: null,
            data: { matchTypeId: stipulation },
          });
          hatedBookings.push({ wrestlerId: wrestler.id, matchTypeId: stipulation });
        }
      }

      wrestler.morale = clamp(wrestler.morale + temper(wrestler, delta));
      continue;
    }

    // Could not have been booked, so this is not a snub.
    if (!bookable(wrestler)) continue;

    wrestler.weeksOffCard += 1;
    const weeks = Math.min(wrestler.weeksOffCard, MISSED_WEEKS_CAP);
    // Ambition decides how hard being overlooked lands. The same empty week is
    // a shrug to one wrestler and an insult to another — this is the whole
    // point of personality, in its smallest possible form.
    const sting = -(MISSED_BASE + MISSED_PER_WEEK * weeks) * (0.5 + wrestler.stats.ambition / 100);
    wrestler.morale = clamp(wrestler.morale + temper(wrestler, sting));

    if (wrestler.weeksOffCard >= GRUDGE_AT_WEEKS && !hasOverlookedGrudge(wrestler)) {
      wrestler.grudges.push({
        id: nextId('gr'),
        week: state.week,
        type: 'overlooked',
        targetId: null, // null means management — the GM. Incidents will name a wrestler.
        data: { weeks: wrestler.weeksOffCard },
      });
      newGrudges.push(wrestler.id);
    }
  }

  // One entry, not one per wrestler. A dozen identical lines is the kind of
  // noise that makes a feed unreadable the moment the roster grows.
  for (const booking of hatedBookings) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'hated-booking',
      data: booking,
    }));
  }

  if (newGrudges.length) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'grudges-formed',
      data: { wrestlerIds: newGrudges },
    }));
  }
}

export function hasMatchGrudge(wrestler, matchTypeId) {
  return wrestler.grudges.some(g => g.type === 'hated-match' && g.data.matchTypeId === matchTypeId);
}

export function hasOverlookedGrudge(wrestler) {
  return wrestler.grudges.some(g => g.type === 'overlooked');
}

export function averageMorale(wrestlers) {
  const pool = wrestlers.filter(bookable);
  if (!pool.length) return 50;
  return Math.round(pool.reduce((sum, w) => sum + w.morale, 0) / pool.length);
}

export function withGrudges(wrestlers) {
  return wrestlers.filter(w => w.grudges.length > 0);
}

export function appearedCount(state) {
  return involvement(state).size;
}

export function bookableCount(wrestlers) {
  return wrestlers.filter(bookable).length;
}

export { bookable };
