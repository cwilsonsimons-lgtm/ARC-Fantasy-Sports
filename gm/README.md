# Wrestling GM — prototype

The player is the kayfabe General Manager of a weekly wrestling television
show. This is the first skeleton: view the roster, book a card, run the show
segment by segment, face the network's verdict, advance the week.

Simulated so far: who you used and who you left out, who beat whom, who keeps
ending up in a ring together, and **who steps in when somebody gets jumped**.
Not yet: championships, backstage incidents, or anything running long.

## The weekly phase machine

```
prep  ──Start Show──▶  live  ──last segment──▶  after  ──Start Week N+1──▶  prep
```

`state.phase` is stored rather than derived from whether a broadcast exists, so
a future phase (the week between shows) slots in without every screen having to
work out where it is. All three transitions live in `js/model/game.js`, which is
the only file that writes `phase`.

The card is editable only during `prep`. Once the show is on the air it is the
record of what was planned, so nothing may rewrite it.

## Running it

```
npm start                      # from the repo root
```

Then open <http://127.0.0.1:8080/gm/>. Plain ES modules, no build step and no
dependencies — the modules need an HTTP server only because browsers refuse to
load them over `file://`.

State is saved to `localStorage` under `wgm_v1`. "Reset prototype data" in the
footer clears it and reseeds the roster.

## Layout

```
js/model/   game state and rules — no DOM, no storage
js/ui/      the only code that touches the page
js/store.js the open save, and the only write path into it
js/saves.js save slots, and the generator that builds a world
js/data/    name pools, archetypes, match types
```

`model/` never imports from `ui/`. That boundary is the point of the structure:
a future backstage-incident system changes the show by calling the same model
functions the buttons call, without going near the interface.

## Data shapes

| Object | Shape |
| --- | --- |
| Wrestler | `{ id, name, gender, alignment, status }` |
| ShowItem | `{ id, type, name, participants[], plannedMinutes }` |
| Show | `{ id, name, runtimeMinutes, items[] }` |
| Broadcast | `{ showId, status, results[] }` |
| Journal entry | `{ id, week, at, type, itemId, data }` |
| Grudge | `{ id, week, type, targetId, data }` |
| Relationship | `wrestler.relationships[otherId] = { matches, segments }` |

Four decisions here exist for systems that do not exist yet:

- **Everything is referenced by id**, never by name or list position, so future
  relationships, grudges, requests and incidents have something stable to point
  at.
- **Matches and segments share one record shape.** Code that walks the card
  never branches on type; a match's participants are `[wrestlerA, wrestlerB]`
  and a segment carries its own name.
- **Planned and actual are stored apart.** `plannedMinutes` lives on the card
  item; what actually aired lives in `broadcast.results` as
  `{ itemId, actualMinutes, status }`. A match running long later is a different
  number in `results`, not a change to either shape. `status` is always `aired`
  today and is where `cut` will go.
- **The current segment is derived**, not stored as a cursor — it is the first
  item with no result yet. Inserting or removing items mid-show later cannot
  desynchronise the position.

`completeCurrent(show, broadcast, actualMinutes)` already takes an actual
duration and defaults it to the planned one. That argument is the seam every
"ran long / ran short / got cut" system will use.

## The journal

`state.journal` records what happened during the current show: one entry when
it goes on the air, one per completed item, one when it ends. `at` is the
show-clock minute.

Entries store **references, not sentences** — a type and an `itemId`, with the
wording composed at render time in `ui/live.js`. That keeps the journal
queryable ("what happened to this item") and means no display string is ever
frozen into saved state. Incidents, requests and messages become new `type`
values; nothing else has to change.

The journal is per-show and is cleared when the next show goes on the air, not
when the week advances, so last week's record is still readable while the new
card is being built. Memory that has to survive across weeks belongs on the
wrestlers themselves, not here.

## Morale and grudges

Morale needs a cause, and there is no incident system yet, so nothing invents a
grievance out of nothing. The one honest cause available is **who was booked and
who was not**:

- Appeared — a small gain, more for main-eventing, more again per five minutes
  of airtime actually aired.
- Did not appear, and could have been — a loss that **grows with each
  consecutive week missed**.
- Injured or unavailable — exempt. They could not have been booked, so being
  left off is not a snub.

One missed week is a slight. **Three in a row becomes a belief**, and that is
when a grudge forms. That threshold is the whole point: repetition is what turns
an event into a grievance that outlives the week it happened in.

Grudges are records, not strings: `{ id, week, type, targetId, data }`. Today
every grudge is `type: 'overlooked'` with `targetId: null`, which means
management — the GM. When incidents exist, `targetId` names a wrestler and the
same list starts showing who is angry at whom. The sentence is composed at
render time, so a grudge stays queryable and no prose is frozen into the save.

All numbers in `model/morale.js` are placeholder tuning, deliberately legible
rather than balanced.

## Demeanour, not digits

Morale is a number under the hood and is **never shown as one** — not in a
table, not as a bar, not on hover. The player gets a word (`Furious` …
`Delighted`) and a colour, from `ui/mood.js`. Rendering the number would turn
reading a locker room into optimising a meter.

The same rule governs the network's verdict: `model/executives.js` returns
verdicts (`'long'`, `'settled'`, `'thin'`), never the score behind the grade.
The player is told the executive's priorities, never their arithmetic.

## The wrestler card

Any wrestler's name, anywhere in the app, opens their card. It holds what the GM
could plausibly know: role, archetype, win-loss record, demeanour, a description
you can edit, a photo you can add, and their top rivals and allies — each of
which opens that wrestler's card in turn.

**Rivals and allies are counted, not invented.** Two people who keep meeting in
the ring become rivals; two who keep sharing a segment become allies. Both live
in the same record and are written symmetrically. Some history is seeded so week
one is not a blank slate.

**Winners.** The world runs on hard kayfabe: wrestling is a real contest, so the
GM books the match and the night decides the result. In-ring ability sets the
odds, with a floor so nobody is ever a certainty. That is what makes a hidden
stat worth learning. `model/matches.js` `decideWinner()` is the single function
to change if the GM should pick winners instead.

## Match types

Seven stipulations, from a plain singles match to an Iron Man that eats
twenty-five minutes of your window. Each carries a minimum runtime, which is how
stipulation reaches the show clock — picking one is a timing decision as well as
a talent one.

Every wrestler carries two separate hidden values per stipulation, and they are
**deliberately uncorrelated**:

| | |
| --- | --- |
| **taste** | do they want this match? drives morale, and grudges |
| **aptitude** | are they any good at it? drives who wins |

That gives four quadrants, and the interesting one is low taste with high
aptitude — Marisol Reyes hates a steel cage and is excellent inside one. Book it
and you win the match and lose the woman. All four are reachable in the seeded
roster.

Taste scales the whole booking rather than nudging it: someone who dreads the
stipulation does not much enjoy the main event either, so the spot is worth a
fraction of what it would have been, and then the stipulation lands on top. A
wrestler put in a match they genuinely dread forms a grudge **immediately** —
unlike being overlooked, that one does not need repeating to land.

Preferences are stored sparsely. A wrestler only carries an entry for a
stipulation they have an opinion about; anything absent is indifference, and
aptitude falls back to their general in-ring ability.

## Progressive revelation

Stats are 0-100 under the hood and are **never shown as numbers**. What the
player gets is a reading that sharpens with familiarity:

| Familiarity | Tier | Stats | Stipulations |
| --- | --- | --- | --- |
| 0-24 | unread | "no read yet" | nothing |
| 25-59 | impression | Below / About / Above average | what they like |
| 60+ | known | Terrible … Elite | what they like **and** how good they are |

Taste and aptitude reveal at different tiers on purpose. What somebody likes is
something they will tell you, so it surfaces the moment you have any read at
all. How good they actually are is something you only learn by watching, so it
takes a full read. The booking screen shows your read on both wrestlers as you
pick a stipulation, so early on you book blind and find out in the aftermath.

Familiarity grows +2 a week for anyone on the roster and +7 more for anyone
actually booked. You learn people by working with them, so the roster you use is
the roster you understand — and the one you ignore stays a guess.

The word scale is centred so a middling value reads as middling. A scale where
44 comes back as "Good" quietly tells the player everyone is fine.

## Personality does something

Each of the five stats has exactly one real effect today, so the roster reacts
differently to identical treatment rather than carrying decorative numbers:

- **In-ring** sets match odds.
- **Ambition** multiplies how hard being left off lands.
- **Ego** raises what the main event is worth and makes opening the show sting.
- **Charisma** decides what they get out of microphone time.
- **Professionalism** flattens every reaction in both directions.

Two wrestlers left off the same show lose different amounts of morale. That is
the whole personality system, in its smallest honest form.

## Reactions

The engine underneath the whole locker room. Something happens to somebody, and
every other wrestler in the building gets a look at it. Most do nothing. The
ones who act do it for a reason, and **the reason is the point** — a save is
never `IF face THEN save`.

Each candidate's pull is a sum of competing motives:

| Pulls | Deterrents |
| --- | --- |
| friendship, faction loyalty, a debt owed, hatred of the attacker, principle, self-interest, respect, ambition | fear of the attacker, spite toward the victim, having somewhere else to be |

Clear the acting line and they go. Land in the band just below it and they come
out, stop, and go back — which damages the relationship **far more** than never
moving at all, and is remembered as its own grudge. Below that, nobody moves,
and that is a result rather than the absence of one.

**A reaction is itself an event.** When somebody makes the save, the attacker's
people get their own look at it, each link in the chain harder to justify than
the last. A two-person rivalry ends up with five wrestlers in it without anybody
scripting that.

Principle is not blind: almost nobody crosses the building out of simple decency
for a heel who has it coming. So "nobody moved" is a situational story about who
the victim is — get jumped as a hated heel and you find out how alone you are.

Tuned against a few thousand simulated matches. Roughly a fifth of matches end
in an attack; of those, saves, hesitations and abandonments are all common, and
a full locker-room brawl happens in under one percent.

**Debt creates itself through play.** A save writes a favour onto the record, and
that favour is a motive the next time the rescuer is the one in trouble.

## The window is earned

A new promotion gets **sixty minutes**. That is deliberately not enough: a
roster of fifteen and five slots means somebody sits at home in week one,
before you have made a single mistake. The hour is what makes "choose who to
disappoint" bite from the start rather than after the roster grows.

Minutes come from the network, and the network pays on the executive's grade —
A is worth +4 trust, B +2, C nothing, D costs 3.

| Trust | Window |
| --- | --- |
| 0 | 60 minutes |
| 6 | 75 minutes |
| 15 | 90 minutes |
| 27 | 105 minutes |
| 42 | 120 minutes |

Reaching two hours takes something like fifteen weeks of near-perfect grades.

**A tier once reached is kept**; trust itself can fall, which stalls progress
rather than reversing it. `keepTier` in `model/network.js` is the one line to
flip if losing minutes after a bad run is the game you want — it is the more
interesting version, and it is not what was asked for.

The dead-air threshold scales with the window rather than being a flat number
of minutes, because six minutes short is a rounding error on two hours and a
tenth of an hour show.

## The show stops and asks

An incident is a situation, not a verdict. The locker room reacts on its own —
that happens in the moment — and then the show **holds** until the GM answers.
Complete Segment is disabled until they do, and the pending incident lives on
the save, so closing the tab does not get you out of it.

Ten answers, from "let them settle it" to a month's suspension. Each carries a
`weight`, and every incident carries a `severity`, and **the room judges the
gap**:

| | |
| --- | --- |
| **harsh** | response much heavier than what happened — the punished wrestler holds it against the office, and so do their close allies |
| **fair** | it fit — the victim is satisfied |
| **weak** | you let it go — the victim takes it badly and every professional on the roster notices |

That comparison is why discipline is judgement rather than a button marked
"harshest". A month off for a shouting match and a month off after a
locker-room riot are the same click and completely different decisions.

Ejections and suspensions **pull the wrestler off the rest of tonight**,
including whatever they were booked for, so a heavy call costs you television.

## Unfinished business

Anything left unresolved becomes an opportunity on the booking screen: book it,
or leave it. "Book it next week" records it as a **promise**, and a promise that
goes unkept is a grudge. Everything goes cold after three weeks, and the person
who was wronged notices that nothing was ever done.

## GM reputation

Nobody picks this at the start. `gmRecord` counts every call by how the room
read it, and a pattern earns a name — The Disciplinarian, The Absentee, The
Matchmaker, The Wild West GM, or an even hand. It shows on the post-show.

## Saves

Each save is a separate world — its own promotion, its own roster, its own ids —
under its own storage key, with an index at `wgm_index_v1` listing them and
remembering which is open. Ids restart per save, so switching saves resets the
counter before priming it from the save being opened.

`store.js` upgrades a save written by an older build rather than discarding it,
and writes the upgrade back immediately so nothing is left half-shaped on disk.
A game played before saves existed lived under a single key; it is adopted as a
slot rather than stranded.

## Roster generation

Every save generates its own roster from a seed, so no two promotions field the
same people.

**Archetypes are the authoring unit; trait values are the simulation unit.** An
archetype (`data/archetypes.js`) declares stat *ranges*, the stipulations it has
a view on, and a couple of bio openers. Generation rolls an individual inside
those ranges and attaches a colour sentence from a shared pool, so two wrestlers
built from the same template share a silhouette and nothing else — different
name, different numbers, different opinions, different place in the social
graph.

Seventeen archetypes, sampled so each save omits some and doubles others rather
than always fielding one of each. Monsters and cult leaders are capped at two
between them: they punctuate a roster, they do not fill it.

Each save also gets:

- **14 to 18 wrestlers**, with first names and surnames both unique across the
  roster.
- **One or two people unavailable to you from day one**, so the card is short
  before you have booked anything.
- **History from before you took the job** — standing rivalries, a couple of
  teams, and whatever the cult leader has been quietly building.
- **A promotion and a show name**, which is what the save is called.

Generation is seeded (`model/random.js`), so a roster is reproducible from its
seed and a test can assert exact output.
