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
import { nextId } from '../ids.js';

const APPEARED_BASE = 2;
const MAIN_EVENT_BONUS = 4;
const OPENER_BONUS = 1;
const MINUTES_PER_POINT = 5;
const MISSED_BASE = 2;
const MISSED_PER_WEEK = 2;
const MISSED_WEEKS_CAP = 4;
const GRUDGE_AT_WEEKS = 3;

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
      const entry = byWrestler.get(id) || { minutes: 0, items: 0, mainEvent: false, opener: false };
      entry.minutes += result.actualMinutes;
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
  return Math.max(MORALE_MIN, Math.min(MORALE_MAX, Math.round(n)));
}

// Applied once, when the show comes off the air.
export function settleShow(state) {
  const appearances = involvement(state);
  const at = elapsedMinutes(state.broadcast);
  const newGrudges = [];

  for (const wrestler of state.wrestlers) {
    const used = appearances.get(wrestler.id);

    if (used) {
      wrestler.weeksOffCard = 0;
      wrestler.morale = clamp(
        wrestler.morale
        + APPEARED_BASE
        + (used.mainEvent ? MAIN_EVENT_BONUS : 0)
        + (used.opener ? OPENER_BONUS : 0)
        + Math.floor(used.minutes / MINUTES_PER_POINT)
      );
      continue;
    }

    // Could not have been booked, so this is not a snub.
    if (!bookable(wrestler)) continue;

    wrestler.weeksOffCard += 1;
    const weeks = Math.min(wrestler.weeksOffCard, MISSED_WEEKS_CAP);
    wrestler.morale = clamp(wrestler.morale - (MISSED_BASE + MISSED_PER_WEEK * weeks));

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
  if (newGrudges.length) {
    state.journal.push(createEntry({
      week: state.week,
      at,
      type: 'grudges-formed',
      data: { wrestlerIds: newGrudges },
    }));
  }
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
