// The championships the brand starts with.
//
// Two singles belts: one that defines the main event and one that gives the
// midcard something to want. Two is enough for rankings to mean different
// things at different levels without inventing divisions.

import { TITLE_TIERS } from '../models/title.js';

export const STARTING_TITLES = [
  {
    key: 'world',
    name: 'World Heavyweight Championship',
    shortName: 'World',
    tier: TITLE_TIERS.WORLD,
  },
  {
    key: 'national',
    name: 'National Championship',
    shortName: 'National',
    tier: TITLE_TIERS.SECONDARY,
  },
];

/**
 * Bring the championships into existence, VACANT.
 *
 * Nobody has held anything yet, which gives the GM something to do in week one:
 * decide who the first champion is and book the match that crowns them. A save
 * that starts with a champion has already made the most interesting decision on
 * the player's behalf.
 */
export function seedTitles(store) {
  const titles = {};
  for (const spec of STARTING_TITLES) {
    const { key, ...rest } = spec;
    titles[key] = store.createTitle(rest);
  }
  return titles;
}
