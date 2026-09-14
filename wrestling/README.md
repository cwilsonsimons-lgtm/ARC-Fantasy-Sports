# Wrestling GM

A wrestling RPG where you play the kayfabe General Manager of a weekly show and
the roster is the main gameplay system. The design this is built to is in
[`docs/wrestling-gm/DESIGN-FOUNDATION.md`](../docs/wrestling-gm/DESIGN-FOUNDATION.md).

Built so far: the **foundation layer** (shared entities, identity, time,
persistence, event log, navigation) and **Tier 1**, the basic GM backbone:

> Roster -> Booking -> Live Show -> Results -> Next Week

Plus **Tier 3**: records, rankings, championships and momentum, all updated
automatically from results.

None of the reactive systems from the design foundation are built. Nobody
refuses a match, nobody holds a grudge, nothing goes wrong backstage.

## Running it

```
npm start                 # serves the repo at :8080
# open http://127.0.0.1:8080/wrestling/index.html

npm run check:wgm         # 86 headless checks across four suites
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

**Run.** Go live and work down the card one segment at a time. Each match
plays out on screen: the clock climbs, the feed fills in, and you find out when
it ends as it ends. Nothing is recorded until the clock reaches the finish, so
the card behind the panel cannot give the result away. Skip to the finish at
any time, or set playback to Instant and never watch one again.

**Override.** Before running a match you can force who goes over. The duration
and the rating still come from the simulation. If you do not override, you live
with the result.

**Results.** Wins, losses, streaks, momentum, morale and ring wear all land on
the wrestler, and a memory of the match goes into their log. Losing to someone
beneath you is remembered harder and can scar. The rankings recompute, the
contenders move, and a belt can change hands, all off the same one result.

**Next week.** The calendar moves on, the roster gets its condition back, and
momentum fades toward neutral. A show cannot air before its date, so the rest
between shows always happens however you navigate there.

## Rankings and championships

**A ranking has to be something a wrestler can argue with.** It is computed from
the match record and nothing else: lifetime win/loss differential as a baseline,
recent results within a 120-day window weighted by how good the opponent was and
how long ago it happened, plus momentum and a streak bonus. Title matches count
for half again as much. Every wrestler's page shows the working, line by line,
because they are going to quote it at you.

Recomputed after every result rather than maintained incrementally, so the
ranking can never disagree with the record it claims to summarise.

**The #1 contender is derived, never declared:** the highest-ranked wrestler who
is not already holding that belt. You can book past them. The booking screen
says so, and it does not stop you.

**A championship is its lineage.** The belt is not a property of the wrestler
holding it; it is a chain of reigns, and the champion is simply the reign that
has not ended. "Who is champion" and "who has ever been champion" are the same
record read two ways, so they cannot drift apart. A reign tracks who it was won
from, on what day, at which show, and how many times it has been defended.

A title changes hands only on a pinfall or submission. A countout, a
disqualification or a time-limit draw is a defence, which gives you a way to
keep a belt on someone while still booking them to lose. Winning or losing one
is the heaviest memory in the game, and always scars.

The starting roster ships with a World champion, a National champion, and a
contender on a six-match winning streak ranked above the champion. Nobody
arranged that; it fell out of the records the roster was authored with.

## The simulation

`matchSim.js` is a pure function of `(segment, wrestler lookup, rng)`. It reads
no module state and writes nothing, which is why every number below is measured
rather than asserted. `tools/wgm-sim-check.mjs` re-measures them on every run.

**The GM sets a ceiling, not a duration.** Two evenly matched wrestlers under a
fifteen-minute limit, over 20,000 matches:

| Finish | Frequency |
|---|---|
| Minute 2 | 3.7% |
| Minute 8 | 8.1% |
| Minute 14 | 6.5% |
| Full limit, a draw | 2.7% |

Every minute from 0 to 14 is reachable, with the bulk landing between minutes 8
and 12. No match ever runs past its limit.

**Who wins.** Strength comes from work rate, star power and durability, moved
by momentum and condition, then raised to a power so that quality converts
sharply into wins:

| Matchup | Favourite wins | Median finish |
|---|---|---|
| Main event vs jobber | 97% | 7.6 min |
| Main event vs midcard | 84% | 8.2 min |
| Two main eventers | 58% | 9.3 min |

An upset is a genuine tail rather than a coin flip. Even matches build to a late
finish; mismatches spread earlier, which is what a squash looks like from
outside. Longer limits draw less often, because there is more time to get a
finish: 4.1% at a five-minute limit, 1.9% at thirty.

Momentum and condition move the result without deciding it. A star facing an
opponent on a hot streak drops from 58% to 44%; worn down to 30 condition
themselves, they drop to 30%.

**The override** forces who goes over and keeps everything else the simulation
produced, so the match still has a real duration and a real rating. Pick it
before running the match. If you do not, you live with the result.

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
  title.js       a championship as its lineage of reigns

js/systems/      the game itself. Subscribes to the log, writes through actions.
  formats.js     what can go on a card and the shape it takes
  booking.js     booking rules, conflicts, and the expected-fill estimate
  matchSim.js    pure: (segment, wrestlers, rng) -> {result, timeline}
  showRunner.js  go live, run the card, grade it, go off the air
  results.js     what a result does to records, momentum, morale and memory
  rankings.js    the ranked table, computed from results, with its working
  titles.js      title changes, defences and #1 contenders
  upkeep.js      condition recovery and momentum fade between shows

js/data/roster.js   fourteen hand-authored wrestlers with starting history
js/ui/              renders the store and calls its actions; holds no game state
  playback.js       spends a finished match back out over real time, so the
                    GM watches the clock instead of reading a finished row
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

No pitch or refusal logic, so nobody turns a match down. Nobody complains about
being ranked below someone they beat. No relationship changes from results, so
no rivalries form on their own. No
backstage locations or incidents, no live levers to fill dead air, no promises,
contracts, budget, GM progression or competing brands.

The data model has the fields and the event log has the vocabulary for all of
it. `results.js` is where reactions will hook in, because it already sees every
result; `booking.js` is where a pitch step goes, because it already sits between
the GM and the card.
