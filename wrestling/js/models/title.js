// The championship model.
//
// A title is its lineage. The belt is not a property of the wrestler holding
// it: it is a chain of reigns, and who holds it today is simply the reign that
// has not ended. That way "who is champion" and "who has ever been champion"
// are the same record read two ways, and they cannot drift apart.
//
// `wrestlerIds` is an array on every reign so that a tag championship works
// later without a second model or a migration.

import { mint, assertId } from '../core/ids.js';

export const TITLE_TIERS = Object.freeze({
  WORLD: 'world',
  SECONDARY: 'secondary',
});

export function createTitle(spec = {}) {
  const {
    id = mint('title'),
    name,
    shortName,
    tier = TITLE_TIERS.SECONDARY,
    activatedOnDay = 0,
    maxHolders = 1,
  } = spec;

  if (!name) throw new Error('createTitle: name is required');

  return {
    id,
    name,
    shortName: shortName || name,
    tier,
    activatedOnDay,
    maxHolders,
    // Every reign this belt has ever had, oldest first. The last entry with no
    // `lostOnDay` is the current one; if there is none, the title is vacant.
    lineage: [],

    // The standing #1 contender. Derived from the rankings and kept here so a
    // change can be noticed and announced; systems/rankings.js owns writing it.
    contenderId: null,
  };
}

/**
 * A single reign. `defenses` counts successful title defences, which is the
 * number a champion will quote at you when you stop booking them in main events.
 */
export function createReign({
  wrestlerIds, wonOnDay, wonFromIds = [], atShowId = null, atSegmentId = null,
}) {
  for (const id of wrestlerIds) assertId(id, 'wrestler', 'title reign');
  return {
    wrestlerIds: [...wrestlerIds],
    wonOnDay,
    lostOnDay: null,
    wonFromIds: [...wonFromIds],
    atShowId,
    atSegmentId,
    defenses: 0,
  };
}

export function currentReign(title) {
  const last = title.lineage[title.lineage.length - 1];
  return last && last.lostOnDay == null ? last : null;
}

export function isVacant(title) {
  return currentReign(title) == null;
}

export function championIds(title) {
  return currentReign(title)?.wrestlerIds ?? [];
}

export function isChampion(title, wrestlerId) {
  return championIds(title).includes(wrestlerId);
}

/** Days the current champion has held it. */
export function reignLength(title, today) {
  const reign = currentReign(title);
  return reign ? Math.max(0, today - reign.wonOnDay) : 0;
}

/** Every completed and current reign involving one wrestler, newest first. */
export function reignsOf(titles, wrestlerId) {
  const out = [];
  for (const title of Object.values(titles)) {
    title.lineage.forEach((reign, index) => {
      if (reign.wrestlerIds.includes(wrestlerId)) {
        out.push({ titleId: title.id, titleName: title.name, index, reign });
      }
    });
  }
  return out.sort((a, b) => b.reign.wonOnDay - a.reign.wonOnDay);
}

/** How many times this wrestler has held anything. */
export function reignCountOf(titles, wrestlerId) {
  return reignsOf(titles, wrestlerId).length;
}

/**
 * A title cannot change hands on a countout or a disqualification, and a draw
 * leaves it where it is. Long-standing wrestling convention, and it matters
 * mechanically: it gives the GM a way to keep a belt on someone while still
 * booking them to lose, which is a lever the later drama needs.
 */
export const DECISIVE_FINISHES = Object.freeze(['pinfall', 'submission']);

export function canChangeHands(finish) {
  return DECISIVE_FINISHES.includes(finish);
}
