# Wrestling GM

A wrestling RPG where you play the kayfabe General Manager of a weekly show and
the roster is the main gameplay system. The design this is built to is in
[`docs/wrestling-gm/DESIGN-FOUNDATION.md`](../docs/wrestling-gm/DESIGN-FOUNDATION.md).

Built so far: the **foundation layer** (shared entities, identity, time,
persistence, event log, navigation) and **Tier 1**, the basic GM backbone:

> Roster -> Booking -> Live Show -> Results -> Next Week

Plus **Tier 3** (records, rankings, championships and momentum), **Tier 4**
(personality, career status, and the judgement of what behaviour is believable)
**Tier 5** (relationships, the GM's own standing, and memory) and **Tier 6**
(morale, satisfaction, and the requests they produce).

The locker room now has a voice. It still cannot act: nobody refuses a booking,
and nothing goes wrong backstage.

## Running it

```
npm start                 # serves the repo at :8080
# open http://127.0.0.1:8080/wrestling/index.html

npm run check:wgm         # 183 headless checks across eight suites
npm run build:wgm         # bundle to wrestling/dist/index.html
```

## A new save is a blank slate

Nothing has happened yet. Every record is 0-0, every belt is vacant, nobody
holds an opinion about anybody, and not one person has a view of the GM: trust
and respect start level at 50 across the roster, morale at 60, momentum at zero.

What IS authored is who these people are rather than what they have done:
personality, ego, ambition, ability, where they sit on the card, which way their
career is pointing, and what they are paid. The characters still differ sharply
from the first minute. Halloran is a superstar's ego stranded on the lower card.
Lund has the professionalism and none of the standing to refuse anything. Wren
has almost no patience. None of that needs a backstory to be true.

Everything else is written by play, which is the point: two saves of this roster
should tell different stories, and they cannot do that if the interesting
history is baked in before anyone wrestles.

With no results at all the rankings still order the roster, because the score
stays purely results-based and the TIE-BREAK falls back to position on the card.
Before anyone has wrestled that is the only honest ordering there is, and it
stops mattering the moment real results arrive.

Vacant belts are a feature rather than a gap: week one's job is deciding who the
first champion is and booking the match that crowns them. A save that starts
with a champion has already made the most interesting decision for you.

`tools/wgm-newgame-check.mjs` guards all of this, including a check that the
shipped roster data declares no records, ties or memories at all. Tests that
need an established locker room build one from `tools/lib/fixtures.mjs`, so the
history lives in the test tooling where changing it cannot change what a
player's first save looks like.

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

Both belts start vacant, so the first champion of a save is one the GM crowned.

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
  relationship.js four axes, a history, and one phrase to describe them
  memory.js      the closed vocabulary of what can be remembered
  request.js     an ask with an ID, a life, and its reasons attached

js/systems/      the game itself. Subscribes to the log, writes through actions.
  formats.js     what can go on a card and the shape it takes
  booking.js     booking rules, conflicts, and the expected-fill estimate
  matchSim.js    pure: (segment, wrestlers, rng) -> {result, timeline}
  showRunner.js  go live, run the card, grade it, go off the air
  results.js     what a result does to records, momentum, morale and memory
  disposition.js how a wrestler regards a booking, with its working. Pure.
  relationships.js what a match does to how the people in it see each other
  gmRelations.js what the GM's own decisions cost the GM
  satisfaction.js six things they judge you on, and what morale settles toward
  requests.js    what they want, whether they would say it, and what it costs
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

## Personality and status

**Ten traits, all 0-100**, each one earning its place by changing a specific
behaviour: professionalism, respect for authority and patience for how they
treat the job; loyalty, jealousy, vindictiveness and aggression for how they
treat people; courage for how they treat risk; volatility and sociability for
how predictable they are. Ego and ambition sit apart from the traits, because
they are what a wrestler wants rather than how they are, and nearly everything
else gets weighed against them.

**Seven rungs on the card**, rookie through jobber, lower card, midcard, upper
midcard, main event and superstar. Position is kept separate from `trajectory`
(rising, steady, declining), because a faded former main-eventer and a kid
climbing toward it can share a rung and behave nothing alike.

### Standing buys the right to say no

`systems/disposition.js` answers "how would this person take this?" for any
booking, and shows its working line by line. The number it returns is a
tendency, not a roll, and nothing acts on it yet.

The rule that makes the behaviour believable is a floor under the final answer,
not a special case anywhere:

| Status | Willingness floor |
|---|---|
| Rookie | 88 |
| Jobber | 75 |
| Lower card | 61 |
| Midcard | 48 |
| Upper midcard | 35 |
| Main event | 21 |
| Superstar | 8 |

A rookie cannot fall below 88 however much they hate a booking, so a rookie
jobber essentially never refuses. A superstar can fall to 8, so they can refuse
almost anything. Give a jobber a superstar's ego and they still accept; the
standing is what is missing, not the temperament.

The interesting cases are the ones the floor catches. Viktor Halloran is a
declining former star on the lower card: asked to open the show against a
jobber his raw willingness is 28, and he is held at 61, complaining but
working. The booking screen shows exactly that, including what he actually
thinks.

Everything else shades around it. Croft asked to open the show against Perry
Lund for six minutes reads: being asked to open the show (-40), thinks Lund is
beneath him (-26), only six minutes for someone of his standing (-19). A grudge
makes a wrestler WANT a match rather than duck it. Being teamed with someone
they resent is held against you. A world title shot is wanted by everyone on
the roster.

## Relationships and memory

### Four axes, not one number

| Axis | Range | What it means |
|---|---|---|
| Affinity | -100..100 | The ally rating. Do they like this person. |
| Hostility | 0..100 | The rivalry rating. How much heat is between them. |
| Respect | 0..100 | Do they rate them as a wrestler. |
| Trust | 0..100 | Would they rely on them when it counts. |

These are genuinely independent, and that is the whole point. You can respect
someone you cannot stand, which is most of the best rivalries in wrestling. You
can like someone you would never trust. Two friends can carry real heat and
still be friends. One number collapses all of that into "how much do you like
them", which is the least interesting of the four.

Every relationship is directed. A's view of B says nothing about B's view of A,
and the wrestler page shows both so the disagreement is visible.

### Rivalries emerge, they are not declared

Losing to someone moves all four axes at once, weighted by who is taking the
loss: respect goes up when they were beaten by someone better and DOWN when
beaten by someone beneath them, hostility rises with vindictiveness, trust
barely moves. Repeated meetings compound, so booking two people against each
other over and over is the GM's most direct way of manufacturing heat.

Heat also cools, about 2.5 points a week, so a feud has to be fed. A rivalry is
any pair above 55 hostility, read off the numbers rather than stored in a list.

In testing, five weeks of the same match with no authoring at all produced
Cassidy Bloom and Nia Sparrow at 74 heat, 69 respect and +42 affinity: a
friendly rivalry between two people who like each other and want to prove
something. Nobody wrote that.

### The GM is a character

Trust and respect are tracked separately because they are separately earned,
and separately damaged. Cutting somebody from a card after booking them costs
trust. Leaving them off television costs respect, and after two shows running
they start remembering it. Handing out a title shot buys goodwill from whoever
gets it and costs you with the contender you passed over, who also takes it out
on whoever took their spot.

### Memory

Twenty-four registered kinds with their own weights and decay rates, so losing
a championship marks someone for years while an ordinary win fades in weeks.
The vocabulary is closed: the invariant checker rejects a memory type no system
can recognise.

Ten kinds are written by play today: wins, losses, upset losses, being cheated
by a disqualification, winning and losing a title, being given a title shot,
being passed over for one, being cut from a card, and being left off television.
Four more are registered and reserved with no system to generate them yet:
betrayal, saves, broken promises and suspensions.

Memory is capped at 60 per wrestler. Beyond that the lightest ordinary memories
are dropped, which is roughly what forgetting is. Scars are never pruned.

## Morale, wants and requests

### Morale has a cause now

Morale used to be a number that events nudged. That is backwards: a wrestler is
not unhappy because something bad happened three weeks ago, they are unhappy
because of where they stand today. Six dimensions are computed from the world,
each showing its working:

| Dimension | Judged on |
|---|---|
| How they are booked | Appearances against what their standing expects, and win rate |
| Television time | Minutes on the air against what they think they are worth |
| Their spot on the card | Average card position, and their rank against their status |
| Championship prospects | Which belt they can plausibly chase, and how close they are |
| What they are paid | Salary against others at the same level, and time left on the deal |
| Standing with you and the room | Trust, respect, allies, enemies, grievances |

The dimensions are weighted per person: an ambitious wrestler cares more about
championships, a big ego about pay and position. Morale then settles toward the
total over time, so events still sting in the moment but the number converges on
something you can point at.

### Requests come from the record, never from a dice roll

Two gates stand between wanting something and asking for it. **Strength** is how
much the world justifies the ask, computed purely from state. **Voice** is
whether this person would say it out loud, which is the Tier 4 rule again: a
rookie speaks at 66, a superstar at 25.

Eight kinds: a title shot, more television time, longer matches, a better spot
on the card, a match with somebody, to settle it with a rival, to be kept away
from somebody, and a tag team partner.

Every request carries its reasons, and they are real. In testing: "Sable Okonkwo
wants a match with Iris Delacroix" because "Delacroix had a fistful of tights and
the referee never saw it". "Trent Mabry wants a match with Damien Croft" because
"Croft beat me in forty seconds and did not bother learning my name". Those are
memories from months earlier, surfacing as demands.

Personality decides the shape of the ask. Somebody with heat and aggression asks
to face their rival; somebody with the same heat and no fight in them asks to be
kept away from them instead.

### There is no Grant button

A request is granted by booking the thing they asked for, so the GM's answer and
the GM's card are the same act. You can refuse to somebody's face, which costs
about half what silence costs. Letting it sit until the show passes is the worst
of the three and the one they remember longest, and being ignored makes them ask
again louder rather than giving up.

## What is deliberately not here

No pitch step, so the disposition model is still read-only and nobody actually
turns a match down. No backstage locations or incidents, no live levers to fill
dead air, no promises the GM can make, no contract negotiation, no budget, no GM
progression, no competing brands. Betrayals and saves have memory types and no
way to happen.

The data model has the fields and the event log has the vocabulary for all of
it. `results.js` is where reactions will hook in, because it already sees every
result; `booking.js` is where a pitch step goes, because it already sits between
the GM and the card.
