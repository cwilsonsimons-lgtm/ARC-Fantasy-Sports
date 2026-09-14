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
 * Create the titles and put them on the wrestlers who held them before the save
 * began, so the roster starts with a champion to chase rather than two vacant
 * belts and no reason for anyone to want anything.
 */
export function seedTitles(store, idByKey, { worldChampionKey = 'croft', secondaryChampionKey = 'delacroix' } = {}) {
  const titles = {};
  for (const spec of STARTING_TITLES) {
    const { key, ...rest } = spec;
    titles[key] = store.createTitle(rest);
  }

  const openingReign = (titleKey, wrestlerKey, heldForDays) => {
    const wrestlerId = idByKey[wrestlerKey];
    if (!wrestlerId) return;
    store.awardTitle(titles[titleKey].id, [wrestlerId], {
      wonOnDay: store.today() - heldForDays,
      reason: 'Held the title coming into the save',
    });
  };

  openingReign('world', worldChampionKey, 112);
  openingReign('national', secondaryChampionKey, 43);

  return titles;
}
