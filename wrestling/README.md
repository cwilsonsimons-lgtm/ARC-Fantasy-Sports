# Wrestling GM

A wrestling RPG where you play the kayfabe General Manager of a weekly show and
the roster is the main gameplay system. The design this is built to is in
[`docs/wrestling-gm/DESIGN-FOUNDATION.md`](../docs/wrestling-gm/DESIGN-FOUNDATION.md).

Built so far: the **foundation layer** (shared entities, identity, time,
persistence, event log, navigation) and **Tier 1**, the basic GM backbone:

> Roster -> Booking -> Live Show -> Results -> Next Week

None of the reactive systems from the design foundation are built. Nobody
refuses a match, nobody holds a grudge, nothing goes wrong backstage.

## Running it

```
npm start                 # serves the repo at :8080
# open http://127.0.0.1:8080/wrestling/index.html

npm run check:wgm         # 47 headless checks: foundation + the Tier 1 loop
npm run build:wgm         # bundle to wrestling/dist/index.html
```

## The weekly loop

**Book.** Pick a format (singles, tag, triple threat, fatal four-way, six-man,
handicap, or a promo, face-to-face or interview), fill its slots, set a time
limit. The booking rules refuse a wrestler in two matches on one night, a
wrestler facing themselves, a short-handed tag, and anyone unfit.

**The limit is a ceiling, not a plan.** Matches typically run about 62% of
their limit, so a card booked to exactly fill the hour leaves the GM short. The
booking screen shows expected fill alongside the booked limits, and the show
rating penalises missing the budget in either direction. Booking past the
budget is the first real skill in the game.

**Run.** Go live and work down the card one segment at a time. The simulation
decides when each match ends from ability, momentum, condition, chemistry and
RNG. A fifteen-minute limit can end at ninety seconds or go the distance to a
time-limit draw. The clock updates as you go.

**Override.** Before running a match you can force who goes over. The duration
and the rating still come from the simulation. If you do not override, you live
with the result.

**Results.** Wins, losses, streaks, momentum, morale and ring wear all land on
the wrestler, and a memory of the match goes into their log. Losing to someone
beneath you is remembered harder and can scar.

**Next week.** The calendar moves on and the roster gets its condition back. A
show cannot air before its date, so the rest between shows always happens
however you navigate there.

### How the simulation is calibrated

Numbers verified by `tools/wgm-loop-check.mjs` and the calibration in the
commit history:

| Matchup | Favourite wins | Draws | Median finish |
|---|---|---|---|
| Main event vs jobber | 97% | 2% | 51% of the limit |
| Main event vs midcard | 85% | 2% | 56% |
| Two main eventers | 57% | 3% | 62% |

Upsets are a genuine tail rather than a coin flip. Even matches build to a late
finish; mismatches spread earlier, which is what a squash looks like. Longer
limits draw less often, because there is more time to get a finish.

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

js/systems/      the game itself. Subscribes to the log, writes through actions.
  formats.js     what can go on a card and the shape it takes
  booking.js     booking rules, conflicts, and the expected-fill estimate
  matchSim.js    pure: (segment, wrestlers, rng) -> a result. Writes nothing.
  showRunner.js  go live, run the card, grade it, go off the air
  results.js     what a result does to records, momentum, morale and memory
  upkeep.js      condition recovery between shows

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

No pitch or refusal logic, so nobody turns a match down. No rankings. No
relationship changes from results, so no rivalries form on their own. No
backstage locations or incidents, no live levers to fill dead air, no promises,
contracts, budget, GM progression or competing brands.

The data model has the fields and the event log has the vocabulary for all of
it. `results.js` is where reactions will hook in, because it already sees every
result; `booking.js` is where a pitch step goes, because it already sits between
the GM and the card.
