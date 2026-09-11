# Wrestling GM — prototype

The player is the kayfabe General Manager of a weekly wrestling television
show. This is the first skeleton: view the roster, book a card, run the show
segment by segment, face the network's verdict, advance the week.

Simulated so far: who you used and who you left out, who beat whom, who keeps
ending up in a ring together, **who steps in when somebody gets jumped**, and
**what everybody remembers about all of it**. Not yet: contracts, money, or
anything running long.

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

State is saved to `localStorage`: an index at `wgm_index_v1` and one key per
save. "Delete all saves" in the footer clears the lot.

```
npm run check:gm               # both halves
node tools/gm-check.mjs --model  # the simulation only, no browser
```

The check runs twice over because the two halves catch different things. It
plays twelve seasons of forty weeks headlessly against the model and asserts on
the distributions — that saves, hesitations and abandonments are all common
outcomes, that morale settles in a spread rather than pinning at an end, and
that **each of the eleven traits measurably changes an outcome**. Then it plays
ten weeks in a real browser, opens a card, checks it at phone width, reloads,
and forces an old save through the upgrade. Every crash this prototype has had
was found by playing it, not by a staged test, so the second half drives the
actual buttons.

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
| Wrestler | `{ id, name, gender, alignment, status, baseline, morale, stats, traits, memories[], grudges[], relationships }` |
| ShowItem | `{ id, type, name, participants[], plannedMinutes }` |
| Show | `{ id, name, runtimeMinutes, items[] }` |
| Broadcast | `{ showId, status, results[] }` |
| Journal entry | `{ id, week, at, type, itemId, data }` |
| Grudge | `{ id, week, type, targetId, data }` |
| Memory | `{ id, week, source, weight, targetId, detail, fade }` |
| Relationship | `wrestler.relationships[otherId] = { matches, segments, owed, tie }` |

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

## Memory is the spine

Morale is **derived, not stored**:

```
morale = their natural level + everything they currently remember
```

Six files used to nudge `wrestler.morale` directly, which meant "why is this one
furious" had no answer. Now every change goes through one call — `remember()` in
`model/memory.js` — which files a memory carrying its own weight, and the number
is recomputed from the memories. `wrestler.morale` still exists on the object
because everything reads it and the save has to serialise, but it is a cached
answer and never a source.

That is not tidiness. A running total gets one thing badly wrong: **memories
fade, and if the number they moved were kept, a wrestler would still be elated
about a title they won two years ago**. Deriving it means people drift back
toward who they are — their `baseline`, rolled at generation — the moment
nothing is happening to them. A locker room with nothing going on is a quiet
one, not a permanently delighted or permanently ruined one.

Memories carry a **source**, which is what the card can name:

| | |
| --- | --- |
| Opportunities | something you offered, or let go cold |
| Television time | whether they were on, where, and for how long |
| Wins and losses | the result, separately from the spot |
| Championships | won, lost, defended, carried |
| How you have treated them | your rulings, your word, and whether you use them |
| How you have treated their friends | the same, landing at one remove |
| The locker room | what other wrestlers did to them, and what they did back |

**How fast a memory fades is a property of the person.** Good news decays at a
flat rate; a grievance decays at a rate set by how vindictive they are — 0.72 a
week for somebody who lets things go, 0.96 for somebody who does not. That decay
is the whole reason a forty-week save is not a roster who all hate you for
things that happened in week three.

**Grudges expire too.** A memory is a feeling; a grudge is a position, and it
outlives the feeling that caused it — but not forever. Each type has a lifespan
(being abandoned lasts longest, a hated stipulation is effectively a standing
objection) scaled again by vindictiveness. A grudge that is still being fed is
refreshed when it is re-filed, so only the ones nobody has topped up go quiet.
Being booked clears an `overlooked` grudge outright: you fixed it.

## What a show does to the room

The one thing a show can always say is **who was booked and who was not**:

- Appeared — a small gain, more for main-eventing, more again per five minutes
  of airtime actually aired.
- Did not appear, and could have been — a loss that **grows with each
  consecutive week missed**.
- Injured or unavailable — exempt. They could not have been booked, so being
  left off is not a snub.

One missed week is a slight. **Several in a row becomes a belief**, and that is
when a grudge forms — after how many depends on how patient the person is, from
two weeks for somebody with none to five for somebody who will wait.

Two more things happen every week, both of which are about somebody else:

- **Wins and losses** are their own feeling, separate from the spot. Losing in
  the main event is still losing, and a big ego feels it further.
- **Somebody else's good night.** Whoever closed the show or won a belt becomes
  an event for everybody who was counting. A jealous wrestler who was left off
  while the main event went to a peer does not need to have been wronged to feel
  wronged — this is the first thing in the game that happens to somebody
  *because of what happened to somebody else*. Everybody past the threshold
  feels it; only the two loudest reach you as a line in the journal.

Grudges are records, not strings: `{ id, week, type, targetId, data }`. A
`targetId` of `null` means management — the GM; otherwise it names a wrestler,
and the same list shows who is angry at whom. The sentence is composed at render
time, so a grudge stays queryable and no prose is frozen into the save.

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
you can edit, a photo you can add, their ability and their personality, what is
currently on their mind, where you stand with them, and everybody in the
building they have an opinion about — each of which opens that card in turn.

**What is on their mind** is the mood broken into its sources, in words rather
than numbers: *Television time — the best thing going. How you have treated them
— weighing on them.* It is the same data the number is made of, which is the
point of deriving morale from memory in the first place.

**Where you stand** is deliberately a different axis from the mood. A wrestler
can be delighted with their year and still think you are a liar, so the standing
reads only the memories that are *yours* — your rulings, your word, how you have
treated their friends, and whether you use them — and it decays far more slowly
than a mood does. What somebody thinks of the office is built over a season and
does not reset because the last month was quiet. Somebody who respects the
office takes a hard call better; somebody who answers to nobody takes it worse,
and remembers it as yours.

The main way that axis moves in an ordinary week is **the card going up**.
Nobody forms a view of management during incidents; they form it every time they
read down the card looking for their own name.

### Relationships have types

Two things feed a relationship, and they work differently.

Most of it is **counted** off the card: people who keep meeting in the ring read
as rivals, people who keep standing together read as allies, and the game works
that out without being told. The rest is **named**, because it cannot be counted
into existence — a tag team is not two people with a high segment count, and
nobody is somebody's mentor because of arithmetic. Generation names a handful
once (a tag team or two, a mentor and their student, sometimes two people whose
lives are tangled up together, an old score from before you took the job, and
the faction the cult leader has been building) and everything downstream reads
the name.

A named tie outranks anything the counts would have said, and it is its own
stated reason when somebody runs in: *That is their tag partner on the floor.*
Everything else falls out of counts, debts, grudges and how they actually feel
about the person — tag partner, faction, brought them up, involved, bad blood,
enemy, holds a grudge, owes them, rival, close ally, friendly, respects them,
distrusts them, has worked with. Mentor and student are the one asymmetric tie:
the same relationship seen from two ends.

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

| Familiarity | Ability | Personality | Stipulations |
| --- | --- | --- | --- |
| 0-24 | "no read yet" | nothing | nothing |
| 25-41 | Below / About / Above average | nothing | what they like |
| 42-59 | Below / About / Above average | high / average / low | what they like |
| 60-79 | Terrible … Elite | high / average / low | what they like **and** how good they are |
| 80+ | Terrible … Elite | "Enormous", "Forgets nothing", "Answers to nobody" | both |

**Personality lags ability**, and deliberately. You can watch somebody wrestle
once and have an opinion about how good they are. Working out whether they hold
a grudge takes considerably longer, and you usually find out the hard way — so a
wrestler can be a known quantity in the ring and still a stranger backstage,
which is exactly the gap the game is about.

A known read speaks each trait's own language rather than a generic scale:
somebody's ego comes back as "Enormous", not "Elite". And **only the ends of a
scale are coloured** — an ordinary patience is not something the player needs to
see from across the room, and a card where all eleven lines shout is a card
where none of them do.

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

## Personality is not ability

They are separate because they behave differently. **Ability decides matches.
Personality decides everything else.** So they live in separate places on the
record — `stats` is what somebody can do, `traits` is who they are — and ego,
ambition and professionalism, which had been filed under ability, moved across.

Two abilities:

- **In-ring** sets match odds.
- **Charisma** decides what they get out of microphone time.

Eleven traits, each with at least one real effect somewhere. **A trait that only
shows on a card is decoration**, so every one of them is verified against an
outcome rather than asserted:

| Trait | What it actually does |
| --- | --- |
| **Ego** | raises what the main event is worth, makes opening the show sting, makes the middle of the card read as a demotion for anyone who thinks they belong on top, and makes a loss land harder |
| **Ambition** | multiplies how hard being left off lands; sends somebody who needs a chance into a brawl that might become one |
| **Aggression** | raises the odds of putting hands on somebody after the bell |
| **Patience** | lowers them; and decides how many empty weeks pass before a slight becomes a grudge |
| **Professionalism** | flattens every reaction in both directions, prevents fights, and decides whether mediation works |
| **Loyalty** | decides whether anybody else's trouble is their business — in a run-in, and when you punish their friend |
| **Jealousy** | decides how much somebody else's main event or championship costs them |
| **Courage** | answers fear of whoever is doing the beating |
| **Respect for authority** | decides whether a hard call is taken as a ruling or held against the office |
| **Vindictiveness** | sets how slowly a grievance fades and how long a position is held |
| **Selfishness** | damps principle and loyalty; sharpens self-interest |

Archetypes declare ranges for the traits they have a view on; anything they do
not mention is rolled from the ordinary middle, so nobody has a trait sitting at
a flat 50 pretending to be eleven dimensions when it is three.

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

**Reasons do not simply add up.** Somebody with five reasons to go was already
going on the strength of the first one, so the pulls are sorted and each one
after the strongest counts for less than the one above it. Without that, a
locker room running for six months is one where the best-connected person has
every motive at once and clears the line every single time — which is how "who
steps in" stops being a question. History caps for the same reason: the
twentieth match against somebody is not twice the grievance of the tenth.

Tuned against several thousand simulated matches. Roughly a fifth of matches end
in an attack; of those, saves, hesitations and abandonments run about 39/32/29,
and a full locker-room brawl is rare.

One thing the numbers deliberately allow: **the rate drifts upward across a
save**. In week two nobody in this locker room owes anybody anything and people
mostly stand and watch. By week thirty there are debts, factions and scores, and
somebody usually goes. That arc is the relationships paying off, so it is left in
rather than normalised away.

**Debt creates itself through play, and is spent.** A save writes a favour onto
the record, and that favour is a motive the next time the rescuer is the one in
trouble. Making the save for somebody you owe settles it — otherwise favours
only ever accumulate, and eventually everybody owes everybody and therefore
everybody runs in.

## Championships

Every promotion starts with three — a major men's, a major women's, and the tag
titles — already held, because vacant belts on day one read as a promotion that
has not started yet. Seeded champions are the best of their division and nobody
holds two.

**Everything here is optional.** Any belt can be retired, including the three
you start with, and a promotion that never adds a fourth is a perfectly good
promotion. Retiring closes the reign and vacates it; bringing it back brings it
back vacant, because the lineage already ended.

More are **sanctioned, not given**: the network opens a slot at 10, 22 and 34
network trust, and the player picks which of the remaining belts to bring in. A
new one starts vacant — somebody has to win it.

A match can carry a title, and the picker only offers belts that could
plausibly be on the line: a tag title needs a tag match, and a locked division
needs everyone in the match to belong to it.

**Tag matches** had to exist for the tag titles to mean anything. Matches were
two participants; they are now two sides. `teamsOf()` in `model/matches.js` is
the only place participants are split into teams, so the convention lives in one
spot, and `decideWinner()` returns the winning *side* rather than one name.

The morale swing on a title change scales with the belt — a major is worth 18
either way, a secondary 11. That has to outweigh the ordinary lift of having
been on the show, or a wrestler can lose a world title and finish the night
happier than they started.

## The calendar

A real month grid. Weeks are integers underneath, but the player thinks in
months and nights, so every save picks a **night of the week to air on** and a
first air date, and week numbers map onto real days from there. All date
arithmetic is in UTC — local time zones turn "the 3rd" into "the 2nd" for
anyone west of Greenwich.

Show nights are the only clickable days, and they all land in one column
because the promotion airs on one night. A past night carries its grade, this
week is outlined, and a future night shows how much is planned and how much of
that is advertised. Clicking one opens it below the grid: a past night reads
back its card and journal, a future night is where you plan, advertise and
quietly tell people. On a phone the show names give way and the grid keeps its
seven columns.

Three things live in `model/calendar.js`: what already happened, what is
planned, and the special events.

**History is kept.** Before this, the journal was cleared at the start of every
show and the card was replaced every week, so a finished show left nothing
behind. `archiveWeek()` snapshots the card, the results, the grade and the
journal before the week turns, capped at a year so a season fits in a browser's
storage.

**Planned is not promised.** A planned match is a note to yourself and costs
nothing to change. Three states, escalating:

| | What it means | What it costs to break |
| --- | --- | --- |
| **Planned** | A note to yourself | Nothing |
| **Told** | You let the wrestler know privately | Morale, and a broken-promise grudge |
| **Advertised** | The audience knows. The network expects it. | All of that, plus a breach the executives lead their memo with |

Advertising lifts the people in it immediately, and telling somebody lifts them
more — it also resets their weeks-off-card counter, because they know they have
not been forgotten. Both are your word, and both are checked when the show
comes off the air: a scheduled item carries the same id onto the card, so
delivery is a lookup rather than a guess.

**Special events** land every twelve weeks, run thirty minutes longer than your
current window, and count double for network trust in both directions. The
planning horizon is eight weeks **plus the next special even when it sits
beyond them** — a big show you cannot see coming is one you cannot book toward.

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
