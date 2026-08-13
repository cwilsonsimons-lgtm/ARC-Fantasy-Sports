// WWE 2K Universe — public surface.
//
// Data layer only: schema, storage, projection, seeding, roster import and card
// entry. Nothing here touches the DOM, so it runs the same under Node (the CLI
// in tools/universe.mjs) as it will in the browser once a dashboard exists.
//
// Typical use:
//
//   const store = new UniverseStore({ adapter: localStorageAdapter() });
//   seedFromJSON(seedDoc, { store });
//   commitRoster(store, parseRoster(pastedText, store));
//   commitCard(store, parseCard(cardText, store));
//   const state = project(store);            // rosters, champions, records
//
// Nothing in `state` is stored. Correct a mistake with store.amendEvent() or
// store.voidEvent() and call project() again — everything downstream moves.

export * from './schema.js';
export * from './store.js';
export * from './project.js';
export * from './seed.js';
export * from './roster.js';
export * from './card.js';
export { buildIndex, resolve, table, heading, norm, plural } from './util.js';
