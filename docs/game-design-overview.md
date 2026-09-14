# The whole game

*A design overview. No code. This organises everything into systems, says how
they depend on each other, names the problems, and proposes an order.*

---

## 0. The one sentence

> **You are the on-screen General Manager, standing in a corridor during a live
> television show, and you cannot be in two places at once.**

Everything below is downstream of that. The test for any proposed feature is
not "would a wrestling game have this" but "does this make the corridor more
interesting". A feature that would work identically if the GM were a menu is a
feature that belongs in a different game.

### The design spine

Four rules the whole thing hangs on. When a decision is unclear, these settle it.

**1. Attention is the scarce resource, not money or time.**
The clock and the budget are real, but what you are actually spending all night
is *where you are looking*. Every system should consume, reward or punish
attention.

**2. The player controls time, order and attention. Never outcomes.**
You book the card, you set the rundown, you decide who gets minutes and who
gets cut. You do not decide who wins, who goes long, who throws a punch, or
who forgives you. The moment the player can dictate a result, the locker room
stops being alive and becomes a spreadsheet.

**3. Every number is derived, and nothing is shown as a number.**
Morale is the sum of faded memories. A rivalry is the sum of faded events. A
scouting report is a claim, not a fact. None of it is stored as a score and
none of it is displayed as one — the player gets words, and reads people.

**4. There is rarely a right answer. There is always a choice about who to
disappoint.**
If a decision has an obviously correct option, it is not a decision. Either
give it a real cost on the other side or remove it.

---

## 1. The core gameplay loop

Three loops, nested. Most wrestling management games only have the outer one,
and that is precisely why they feel like spreadsheets.

### The minute loop — the one that makes this game what it is

```
     Where do I stand?
            |
     What can I see from here?
            |
     What do I do about it?  ──────── costs minutes
            |
     What happened while I was doing that?
            |
     Where do I stand now?
```

This runs continuously while the show is on the air. It is the heart of the
game and every other system feeds it. The GM has a location, a number of
minutes before the next segment starts, and incomplete information. Walking
somewhere costs minutes. Talking to somebody costs minutes. Standing still
costs the things you could have prevented.

### The week loop

```
   Book the card  →  Run the show  →  Aftermath  →  Consequences  →  Book again
        ↑                                                               |
        └───────────────────────────────────────────────────────────────┘
```

Booking sets up the night. The night produces incidents, results, and moments.
The aftermath is where the locker room reacts and head office grades you.
Consequences — grudges, promises coming due, injuries, suspensions ending — are
what next week's card has to be built around.

### The season loop

```
   Run weeks  →  Earn trust and XP  →  Spend points  →  Bigger show, bigger roster
        ↑                                                          |
        └──────────────── more people to disappoint ───────────────┘
```

The crucial property: **the season loop makes the week loop harder, not
easier.** More minutes to fill, more wrestlers who want them, more belts to
defend, more promises outstanding. Progression buys tools *and* load.

### The chain the whole thing exists to produce

```
Event → Reaction → Memory → Relationship change → Future incident → Booking opportunity
```

Nobody writes a storyline. Somebody gets attacked; somebody else does or does
not go and help; both of them remember it; the relationship moves; that changes
who steps in next time; and now there is a match the audience wants to see that
the player never planned.

---

## 2. The major systems

Thirteen. Grouped by what they are for.

### The people

**Personality (11 traits)** — ego, ambition, aggression, patience,
professionalism, loyalty, jealousy, courage, respect for authority,
vindictiveness, selfishness. The engine of differentiation: two wrestlers given
identical treatment must react differently, and the trait is the reason.

**Memory** — everything that happens to somebody is filed with a weight and
fades. Morale is not stored; it is the sum of what they are still carrying.
This is the single most important system in the game and everything else writes
to it.

**Relationships** — allies, rivals, tag partners, faction members, mentors,
enemies. Formed from what actually happened rather than assigned.

**Standing with the GM** — a separate, slower-moving track from morale. A
wrestler can be delighted with their year and still think you are a liar.

### The night

**Presence and location** — ten backstage rooms, a walking cost, and a
visibility rule: witnessed / heard about / missed. The GM's information is
always partial and always a consequence of where they chose to stand.

**The rundown and the clock** — planned durations, a broadcast window, and the
gap between segments as the GM's working time. *(Overrun is the major unbuilt
piece; see §8.)*

**Incidents** — ten kinds of trouble, raised to the GM as situations rather
than resolved automatically. The GM rules; the room reads the ruling as fair,
harsh or weak.

**Reactions and chains** — when somebody is attacked, the game asks everybody
who could plausibly intervene whether they do. Allies, partners, factions,
rivals of the attacker, or simply somebody who thinks it is wrong. Cowards
refuse; some hesitate and damage a friendship by hesitating; sometimes nobody
comes.

### The stories

**Rivalries — two axes** — *heat* (how invested the crowd is) and *hatred*
(what the two of them actually feel), which move apart on purpose. Heat only
comes from what went out on television, which is why a corridor grudge is a
problem you have to decide whether to broadcast.

**Promos** — the one segment where the GM sets the temperature rather than the
outcome. Five rungs from Calm to About to Fight, and a list of material derived
from things that really happened between the two of them.

**Championships** — belts, lineage, contendership, and the politics of who is
owed a shot.

### The pressure

**Head office** — grades the show on timing, locker-room condition, roster use,
backstage order, and (smallest) what actually went out. Their priorities
conflict with the wrestlers' by design.

**The GM's own progression** — seven branches, XP earned for running the
building rather than for producing good matches, and a points economy tight
enough that no two GMs end up the same.

**Money** — the network pays per televised minute; the roster is paid whether
or not you book them. Small, and its only job is to make roster size and show
length into real decisions.

### The systems that do not exist yet

**Requests** — the peacetime channel. Wrestlers asking for time, opponents,
wins, title shots, partners, nights off. This is the biggest missing system and
the one that would most change how the game feels between incidents.

**Scouting and the outside world** — an indie and feeder pool that lives its
own life whether or not you are looking at it.

---

## 3. The dependencies that matter

Not an exhaustive graph — the five that actually constrain the build order.

**Memory is underneath everything.** Every other system's job is ultimately to
write a memory. Personality decides how hard it writes. If memory is wrong,
nothing above it can be right. *Built, and load-bearing.*

**Presence gates information, and information gates decisions.** Incidents,
requests, sabotage and open challenges are all systems whose interest comes
from the GM not necessarily knowing. Remove presence and they all collapse into
notifications. *Built.*

**The clock gates the live layer.** Overrun, cutting segments, reordering,
buying two minutes, hard outs, entrance trims — every one of these is a
different verb performed on the same rundown. Build the rundown properly and
you get six features; build it loosely and you get six special cases.
*Partially built: `actualMinutes` exists and is always equal to planned.*

**Rivalries depend on events, and events depend on the night running.** The
two-axis reading is composed from the thread's event list, so anything that
should be able to start a feud has to remember to file an event. *Built.*

**Progression must not gate content the brief says is free.** See §8.1 — this
is currently violated.

---

## 4. Where we actually are

Honest status, because a roadmap that ignores what exists is fiction.

| System | State |
|---|---|
| Personality, memory, morale, relationships | **Built** and stable across 19 save versions |
| Presence, locations, visibility, the backstage clock | **Built** |
| Incidents, rulings, discipline, suspension ladder, authority | **Built** |
| Reactions, chains, saves, post-match moments, factions | **Built** |
| Match shapes — any arrangement to 8 sides × 8, battle royals | **Built** |
| Rivalry heat/hatred, promos, ammo, anticipation, match quality | **Built** |
| Championships, lineage, trust-gated slots | **Built** |
| Head office, grades, reputation, bossView | **Built** |
| GM board — 7 branches, 113 upgrades designed | **16 built**, the rest drawn and greyed |
| Money — rights fee, wages, weekly settlement | **Built**, deliberately small |
| Promotion setup, full wrestler authoring, share codes | **Built** |
| Calendar, advertised matches, breaches | **Built** (two commitment levels, not four) |
| PPVs | **Named only** — every twelve weeks, +30 minutes, no distinct format |
| **The live rundown running long** | **Not built.** The hook exists and is unused |
| **Requests / negotiation** | **Not built.** Whole branch |
| Locker rooms — keep a roster, load it into another promotion | **Built** |
| **Scouting, the indie pool, the living outside world** | **Not built.** Inward half only |
| **Open challenges, the race to Gorilla** | **Not built** |
| **Sabotage** | **Not built** |
| **Roster capacity as progression** | **Not built** |
| **Boss directives** | **Not built** |
| Supernatural archetypes | One archetype (`cult-leader`) and a faction hook |

---

## 5. What to build first

In order, with the reasoning. Each is a week or two of work, not a quarter.

### 1. Un-gate the match types *(a correction — see §8.1)*

Half a day. It removes a contradiction with the brief and unblocks honest
thinking about what the Booking branch is actually for.

### 2. The show that runs long

**This is the most identity-defining unbuilt system in the game**, and nothing
else comes close. Right now every segment takes exactly its planned time, which
means the rundown is a plan that is always kept — and a plan that is always
kept is a spreadsheet.

Once matches can run long:
- the six-minutes-to-find decision exists, which is the scene the brief opens with
- cutting, shortening, reordering, trimming entrances and changing the main
  event all become real verbs rather than hypotheticals
- *Buy Me Two Minutes*, *Hard Out*, *Flexible Rundown* and *Card Subject To
  Change* stop being flavour text on a board and become the Production branch
- the wrestlers whose segments get cut have something to remember
- "he always goes long and other people pay for it" becomes a real locker-room
  grievance

There is also a happy accident waiting in the existing design. The gap between
segments *is* the GM's backstage time. So a match that runs six minutes long
hands the GM six more minutes backstage and costs them six minutes of
television. **Going long is simultaneously a gift and a problem**, and that
falls straight out of the architecture without anything being invented.

### 3. Requests

The peacetime pressure loop. Between incidents the game currently goes quiet;
requests are what fill that silence with pressure. "I have eight minutes
tonight. Give me twelve."

Approve, deny, compromise, make it conditional, trade time against a shorter
entrance, promise next week. Different personalities take "no" differently, and
one of them ignores you and goes long anyway — which connects directly to the
system above.

### 4. Four commitment levels and real promises

Idea → Planned → **Talent Informed** → Advertised.

The third one is the whole point: the moment you tell a wrestler, it stops
being a plan and becomes a promise with a deadline attached. Cheap to build on
top of the existing scheduling, and it is the backbone that makes "you cut my
match in April and gave my title shot away in June" possible.

### 5. Gorilla and the open challenge

The best set-piece in the brief. A champion tells you they want to issue an
open challenge; you can let it happen, quietly call somebody, or pick in
advance. If it happens naturally, several wrestlers race to Gorilla and argue
about who deserves it. If you pre-picked, the room may work out you did, and
you can tell the truth or lie.

It needs presence (built), rivalries (built), standing (built) and requests
(#3). It is the payoff for all of them.

### 6. Scouting and the outside world

Large, self-contained, and it can wait. Everything above changes how every
single week feels; scouting changes what happens between them.

---

## 6. What to save for later

Not because it is unimportant — because it depends on things that should be
solid first, or because it is an expansion of a system rather than a system.

**Sabotage.** Depends on requests and open challenges existing to be sabotaged.
Also carries the hardest design problem in the brief (§8.4).

**The living indie world.** The pool has to exist before it can live a life.
Signing somebody who reunites an old tag team is a wonderful moment, and it is
worth nothing if the roster systems underneath are shaky.

**PPV as a distinct format.** Currently a longer show with a name. Making it
genuinely different — multi-week build, higher stakes, blow-off matches, bigger
consequences for a breach — is a real system, and it needs commitment levels
(#4) first.

**Boss directives.** "Get the title off him by the spring." Excellent pressure,
but it needs the promise system to model the GM being held to something.

**The uncanny.** Rare, atmospheric, and easy to get wrong. It should arrive
once the ordinary locker room is convincing, because the whole effect depends
on contrast (§8.7).

**Roster capacity.** Straightforward, but only meaningful once there is enough
per-wrestler pressure that more wrestlers is a burden. Build the requests
system first or a bigger roster is just a longer list.

**Multi-brand, drafts, rival promotions poaching your roster.** Real
expansions. None of them are the identity.

---

## 7. Essential versus optional

### Essential — remove any of these and it is a different game

| System | Why it is load-bearing |
|---|---|
| **Presence and partial information** | Without it the GM is a menu. This is the single most distinctive thing about the design. |
| **Memory-derived morale** | "They remember" is the promise. A mood bar that resets is a different genre. |
| **Personality changing reactions** | Without it every wrestler is the same wrestler with a different name. |
| **The live rundown with overrun** | The difference between running a show and submitting one. |
| **Incidents the GM rules on** | The game's core verb. |
| **Requests** | The other half of the core verb. Incidents are wartime; requests are peacetime. |
| **Promises with deadlines** | What makes the past able to accuse you. |
| **Two-axis rivalries** | Stops feuds being a single meter and makes "put it on TV" a decision. |
| **Progression that adds load** | The anti-power-fantasy rule. Without it the late game is easy and boring. |
| **Emergent chains** | The stories have to write themselves or the premise fails. |

### Optional — genuinely good, genuinely cuttable

Sabotage · the living indie world · supernatural archetypes · PPV as a distinct
format · multi-brand · deep production tools (split screen, the hard camera,
replays) · contract negotiation · a developmental territory · rival promotions ·
house shows.

Every one of these is an expansion of something in the essential list rather
than a new pillar. That is the test.

---

## 8. Contradictions and design problems

The most useful section. Nine of them, hardest first.

### 8.1 The match-type lock — resolved, and un-gated

> **Settled.** Every match type and shape is now available from week one. The
> Booking branch was rewritten into capacity — roster size 18 → 60, how far
> ahead you can commit, contendership, the main-event scene — and the only
> thing it still relaxes is *who you may put on the same side*. What follows is
> the reasoning, kept because the argument is worth having on the record.

**The problem.** The brief says: *"All normal match types should be available
from the beginning. I do not want basic match types arbitrarily locked behind
progression."* The current build does exactly that: tag teams, triple threats,
fatal four-ways and the submission stipulation are Booking-branch purchases,
and a level-1 GM can only book singles matches.

I argued for that when I built it — the multi-way fall rule (only one side takes
the loss) is the most useful thing a new GM can learn, and it lands harder as an
unlock than as an option that was always in the dropdown. **That argument is
overruled, and it should be.** A GM who cannot book a tag match is not a GM,
and the lock buys a tutorial beat at the cost of the fantasy.

**The fix.** Every match type and shape available from week one. The tutorial
value is recoverable for free: the first time the player books a multi-way, the
card says what the fall rule means, once.

**What the Booking branch becomes instead**, per the brief's own list: roster
capacity, show length, championship capacity, number of simultaneous
storylines, contendership tools, advertising further ahead, and the tag-team
relationship requirement relaxing over time. That last one is worth keeping —
it is a restriction on *who* you may team, not on *what matches exist*, which
is a different thing and one the brief explicitly endorses (*Forced
Partnership*).

**Migration.** Done. The ten match-type nodes came off the board, the catalogue
went from 113 upgrades to 108, and nothing had to be granted to anybody because
nothing is gated any more.

### 8.2 "You do not control the show" versus "make live changes to the show"

These sound contradictory and are not, but the line has to be drawn explicitly
or the game will drift across it.

**The rule: the player controls time, order and attention. Never outcomes.**

| The GM may | The GM may never |
|---|---|
| Shorten a segment | Decide who wins |
| Extend a segment | Decide how long a match *actually* runs |
| Cut a segment entirely | Decide whether somebody obeys |
| Reorder the card | Decide whether a promo stays a promo |
| Trim or cut entrances | Decide who intervenes in a fight |
| Change the main event | Decide how somebody feels about any of it |

Everything in the left column is a decision about the rundown. Everything in
the right column belongs to the wrestlers. *Hard Out* is the interesting edge:
it makes compliance much more likely, and never certain — which is exactly the
right shape for an upgrade in this game.

### 8.3 Two clocks that are actually one clock

Worth naming because it looks like a problem and is a gift.

The game has the **broadcast clock** (how much of the window is gone) and the
**GM's clock** (how long until the next segment starts, which is their working
time backstage). These are the same number viewed from two sides: the gap
between segments *is* the segment that is on the air.

So when overrun is built, a match running six minutes long **gives the GM six
extra minutes backstage and takes six minutes off the rest of the card.** That
is a genuinely interesting trade that requires no new mechanism, and it means
the answer to "a match went long" is never simply bad.

One consequence to design for deliberately: a GM in trouble backstage now has a
reason to *want* a match to run long, which is a delicious and slightly
corrupting incentive. Leave it in.

### 8.4 Invisible sabotage reads as a bug, not as depth

**The problem.** The brief asks for sabotage the player may never learn about —
a wrestler locked somewhere, a rival lied to, a fight started to clear the way
for an opportunity. Systems the player never perceives do not register as
depth. They register as *"why was he unavailable? this game is buggy."*

**The rule that fixes it: every hidden act leaves a trace that can be found.**
Not always immediately and not always conclusively, but always eventually:

- **At the time** — an *absence* the player can notice if they are in the right
  room. Not "sabotage occurred", just: he is not where he should be.
- **Soon after** — a rumour. *Somebody says they saw him near the loading bay.*
  Unconfirmed, and possibly wrong, which is better than certain.
- **Later** — the victim brings it up in a grievance, or a scouting-style
  Locker Room Sources upgrade surfaces it, or the saboteur's ally lets it slip
  during a promo.

The feeling to aim for is not *"I was cheated"* but *"…that is why."* Suspicion
is the product. Certainty months later is the payoff.

### 8.5 Inaccurate scouting must be legible in hindsight

Same family of problem. A report that was wrong is only good design if the
player can see *why* they were wrong — and the honest answer is almost always
"you did not spend enough hours on him".

**The rule: a report states its own confidence, and the confidence is visible
at the moment of signing.** "Two hours: he looks professional" is a claim with
a stated thinness. Signing on it is a risk the player took, and when the ego
turns up they know exactly which corner they cut. A report that hides its own
uncertainty is a lie the game told, and that is never acceptable.

### 8.6 Match ratings quietly turning this into a booking sim

The brief is emphatic that this is not a booking simulator, and also asks for
match ratings affected by crowd investment, heat, chemistry, stakes, payoff and
build. Both are right, and they are in tension, because a visible rating becomes
the score the player optimises.

**Three rules keep it safe:**

1. **The rating is never the headline.** It is one of five verdicts head office
   gives, and deliberately the smallest. The locker room's condition outranks it.
2. **Ability is a minority of it.** Currently about a third, with the rest being
   things the GM built. A technically ordinary match between two people the
   crowd desperately wants to see should beat a great match between strangers —
   which is the brief's own stated goal.
3. **It is never a number to the player.** A word. *"A classic"*, *"Flat"*,
   *"It died out there"*.

If the player ever finds themselves booking their two best workers every week
and ignoring everyone else, the balance is wrong and the grade weight should
come down.

### 8.7 The uncanny versus the grounded tone

Supernatural or psychological wrestlers are asked for, and one careless
implementation turns a management game into a fantasy game.

**The rule: they bend social rules, never physical ones.** They manipulate,
recruit, refuse authority, make strange demands, turn up where they should not
be, and know things they should not know. Nothing they do is *impossible* —
every single incident has a mundane explanation available, and the game never
confirms which one is true.

The lights do not go out on their own. Somebody turned them off. Probably.

### 8.8 Progression that expands capacity must also expand pressure

Roster capacity is the clearest case. Going from 18 to 28 wrestlers is only
interesting if those ten extra people generate ten extra people's worth of
wanting things. The wage bill already does part of this. Requests will do the
rest.

**The rule to hold: every capacity upgrade ships with the pressure it
creates**, in the same release. A bigger roster with no request system is just a
longer list, and shipping it early would make the game feel *emptier* rather
than bigger.

### 8.9 The hostage scenario is a set-piece pretending to be a system

*"Your main-eventer is being prevented from leaving a locker room and the main
event is in twenty minutes."* It is a wonderful scene and it should exist. The
risk is building it as a bespoke script that fires once and never recurs
naturally.

**Build it as a general frame: a crisis is an incident with a deadline attached
to a specific card item.** The main event in twenty minutes is one instance. So
is a champion refusing to come out, a tag team splitting up ten minutes before
their match, or an injury in the opener that empties the third segment. One
system, many nights.

---

## 9. Simplifications that keep the fantasy

Ten places where the cheap version is as good as the expensive one — or better.

**1. Derive, never store.** Morale, rivalry heat, hatred, anticipation, promo
material — all composed at the moment they are asked for, from event lists that
already exist. No separate numbers to keep in step, no migration when the
formula changes, no drift.

**2. Prose is composed at render time.** The save holds a type and some ids.
Nothing ever writes an English sentence into stored state, so every line in the
game can be rewritten without touching a single save.

**3. Locations are a graph, not a map.** Ten rooms, a neighbour list, a walking
cost in minutes. No pathfinding, no floor plan, no avatar. Location is an
information mechanic, exactly as the brief asks.

**4. The gap is the segment.** No separate backstage timeline. See §8.3.

**5. Promo material is derived, not authored.** The list of things two wrestlers
can bring up is generated from their actual history. No writing, no content
treadmill, and it automatically gets more personal as a rivalry ages.

**6. One incident frame for everything.** Backstage fights, post-match attacks,
promos that turn physical, refusals and crises are all the same object with the
same eleven responses. New trouble is new data, not new code.

**7. Reports are claims with confidence attached.** Scouting does not need a
simulation of what is true versus what is known — it needs a value, a stated
confidence, and a roll. The gap between them *is* the system.

**8. The indie world can live cheaply.** It does not need a full simulation. A
handful of events per month applied to a pool — a title change, a team forming,
somebody getting hurt, somebody improving — produces the feeling of a world
that moved while you were not looking. The feeling is the deliverable, not the
fidelity.

**9. Commitment levels are a field, not a system.** Idea / Planned / Talent
Informed / Advertised is one enum on an existing scheduled entry. The promise
machinery already exists.

**10. The uncanny is a flag and a tone, not an engine.** Rare archetypes that
skip an authority check and file strangely-worded incidents. No new subsystem.

---

## 10. The roadmap

Seven phases. Phases 0 to 1 are the difference between a promising prototype
and the actual game.

### Phase 0 — done

Personality, memory, relationships, presence, incidents, reactions, chains,
match shapes, championships, head office, rivalries, promos, the GM board,
money, promotion setup and full wrestler authoring. Nineteen save versions, 168
automated checks.

### Phase 1 — the show becomes live *(next)*

Un-gate the match types. Make `actualMinutes` mean something. Overrun driven by
personality, mood, stipulation and crowd. The six-minutes-to-find decision.
Cutting, shortening, reordering, trimming entrances, changing the main event —
and the memories each of those files. *Buy Me Two Minutes*, *Hard Out* and
*Flexible Rundown* become real.

**Done when:** a wrestler who always goes long is a locker-room problem other
wrestlers complain about.

### Phase 2 — the request channel

The standing queue of wants. Approve, deny, compromise, trade, defer, promise.
*Make It Up To You*. Four commitment levels and promises with deadlines. The
Negotiation branch becomes buildable.

**Done when:** a quiet week still has pressure in it.

### Phase 3 — Gorilla

Open challenges, the race, the argument about who deserves it, the pre-picked
favourite, and the choice to tell the truth or lie. Champions bringing you their
plans. The GM's reputation for fairness starts to have visible consequences.

**Done when:** the locker room can believe you play favourites, and be right.

### Phase 4 — the outside world

The indie and feeder pool. Scouting hours, reports with confidence, deeper
tiers revealing personality and hidden problems. The pool living its own life.
Signings that reunite old teams or import old grudges.

**Done when:** signing somebody changes the locker room's politics, not just its
size.

### Phase 5 — scale

Roster capacity as progression (18 → 60), the broadcast ladder to 180 minutes,
more championships, PPVs as a distinct format with multi-week build, boss
directives, and the GM reputation system surfacing properly.

**Done when:** a level-25 GM has visibly more problems than a level-5 GM.

### Phase 6 — the sharp edges

Sabotage with its trace rule. Crises with deadlines. Wrestlers actively
disrupting a show. The hostage scene. Extreme grudges with real teeth.

**Done when:** a show can genuinely fall apart, and it is always somebody's
fault and never the game's.

### Phase 7 — the uncanny

Rare archetypes who bend the social rules. Followers. Incidents that never quite
resolve. Nothing impossible, nothing confirmed.

**Done when:** the player is not sure, and likes not being sure.

---

## The standing test

Before anything goes in, one question:

> **Does this give the player a new way to be in the wrong place at the wrong
> time — or a new person to disappoint?**

If neither, it belongs in a different wrestling game.
