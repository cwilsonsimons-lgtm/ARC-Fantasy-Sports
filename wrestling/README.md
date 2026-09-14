# Wrestling GM

A wrestling RPG where you play the kayfabe General Manager of a weekly show and
the roster is the main gameplay system. The design this is built to is in
[`docs/wrestling-gm/DESIGN-FOUNDATION.md`](../docs/wrestling-gm/DESIGN-FOUNDATION.md).

This directory contains the **foundation layer only**: the shared entities,
identity, time, persistence, event log and navigation that every later system
builds on. None of the game systems described in the design foundation are built
yet.

## Running it

```
npm start                 # serves the repo at :8080
# open http://127.0.0.1:8080/wrestling/index.html

npm run check:wgm         # headless integrity check of the core
npm run build:wgm         # bundle to wrestling/dist/index.html
```

## The one rule

**A wrestler is one object, in one place, referenced by ID from everywhere
else.** `state.wrestlers[id]` is the only home. A match stores `wrestlerId`, a
relationship is keyed by the other wrestler's ID, a memory stores `aboutIds`, an
event stores `subjects`. Nothing anywhere holds a second copy.

This is enforced, not just documented. `core/invariants.js` walks the entire
state looking for wrestler-shaped objects living outside the registry and
reports them by path, and it runs on every save load. `tools/wgm-check.mjs`
plants a duplicate deliberately to prove the detector fires.

## Layout

```
js/core/         owns the world. DOM-free, so it runs under node.
  ids.js         typed, minted, human-readable entity IDs
  rng.js         seeded generator, its position carried in the save
  clock.js       the calendar: game time is one integer, dates are derived
  events.js      the global event log: registry, bus, queries
  store.js       the single state container and the only mutation surface
  persist.js     versioned save/load with migrations and integrity gating
  invariants.js  the checks that keep the one-entity rule true

js/models/       pure entity factories and derived reads
  wrestler.js    the six layers: identity, ability, standing, state, ties, memory
  show.js        a dated container with a time budget and ordered segment IDs
  segment.js     matches and segments as one model, with a time LIMIT not a duration

js/data/roster.js   fourteen hand-authored wrestlers with starting history
js/ui/              renders the store and calls its actions; holds no game state
```

Nothing below `ui/` imports anything above it. That is why the whole simulation
can be exercised headlessly.

## How a later system plugs in

Systems do not reach into each other. They subscribe to the event log, read
entities by ID, and write through store actions:

```js
import * as store from './core/store.js';
import { EVENT_TYPES } from './core/events.js';

// A standings system, for example, would start like this.
store.on(EVENT_TYPES.SEGMENT_COMPLETED, (e) => {
  for (const id of e.data.winnerIds) {
    const w = store.getWrestler(id);                 // the one entity
    store.updateStanding(id, { wins: w.standing.wins + 1 },
      { reason: 'won on the show', cause: e.id });   // emits its own event
  }
});
```

`cause` threads the new event back to the one that produced it, so any
consequence can be walked to its root through `store.causeChain(eventId)`. That
is what keeps the design's "the player should always understand the surprise
afterwards" true in the data rather than only in the fiction.

Subscriptions are app-level: register once at boot and they survive a new game
or a save load.

### Adding an event type

`EVENT_TYPES` in `core/events.js` is the whole vocabulary, and `emit` rejects
anything not registered there. Types for systems that do not exist yet
(promises, incidents, rivalries, contracts, rankings) are already declared, so
those systems extend this log rather than starting a second one.

### Adding a field to an entity

Add it to the model factory, then add a migration in `core/persist.js` keyed by
the schema version you are moving from, and bump `SCHEMA_VERSION` in
`core/store.js`. Old saves keep loading instead of failing quietly.

## What is deliberately not here

No match simulation, no booking pitch or refusal logic, no standings or rankings
updates, no contracts, budget, promises, backstage incidents, rivalries, GM
progression or competing brands. The data model has the fields and the event log
has the vocabulary for them; the behaviour is future work.

One placeholder exists and is labelled as such: the "record result" control on
the show screen fills in a segment result with flat randomness and reads no
wrestler stat at all, so it cannot be mistaken for the simulation. It is there
only to exercise the event chain and the time bookkeeping end to end.
