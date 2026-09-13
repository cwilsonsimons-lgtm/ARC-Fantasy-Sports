# Wrestling GM — prototype

The player is the kayfabe General Manager of a weekly wrestling television
show. This is the first skeleton: view the roster, book a card, run the show
segment by segment, face the network's verdict, advance the week.

You are also, all night, **standing somewhere specific** — and that decides
what you see, who you can talk to, what you get to rule on, and what happens
without you.

Simulated so far: who you used and who you left out, who beat whom, who keeps
ending up in a ring together, **who steps in when somebody gets jumped**,
**what everybody remembers about all of it**, **which of it you were in the
room for**, and **what all of that adds up to** — the game keeps a reading of
its own feuds, and nobody wrote them. Not yet: contracts, money, or anything
running long.

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
ten weeks in a real browser: books cards, crosses the building, hears people
out, answers what it walks into, opens a wrestler card, checks the layout at
phone width, reloads, and forces an old save through the upgrade. Every crash
this prototype has had was found by playing it, not by a staged test, so the
second half drives the actual buttons.

Where a trait's effect is narrow, the check measures the mechanic rather than a
proxy — vindictiveness against how much of a grievance somebody is *still
carrying*, not how many rows their ledger has, because the row count saturates
against its cap once a season is long enough and then it has stopped measuring
anything.

## Layout

```
js/model/   game state and rules — no DOM, no storage
js/ui/      the only code that touches the page
js/store.js the open save, and the only write path into it
js/saves.js save slots, and the generator that builds a world
js/data/    name pools, archetypes, match types, the building, the catalogue
```

The bigger model files, roughly in the order the game reaches for them:

| | |
| --- | --- |
| `game.js` | the phase machine, the only file that writes `phase` |
| `memory.js` | morale, derived from what people remember |
| `traits.js` | the eleven personality dimensions |
| `matches.js` | who wins, and who the result goes against |
| `backstage.js` | where the GM is, the clock, and whether they can see a thing |
| `backstage-events.js` | what the building throws at them, and who it lands on |
| `post-match.js` | what the bell produces |
| `incidents.js` | one resolver for every kind of incident |
| `reactions.js` | who steps in, who breaks it up, and who does not move |
| `discipline.js` | what the GM's answer does to everyone |
| `threads.js` | the feuds the game noticed, read back off everything above |

`model/` never imports from `ui/`. That boundary is the point of the structure:
a future backstage-incident system changes the show by calling the same model
functions the buttons call, without going near the interface.

## Data shapes

| Object | Shape |
| --- | --- |
| Wrestler | `{ id, name, gender, alignment, status, baseline, morale, stats, traits, memories[], grudges[], relationships }` |
| ShowItem | `{ id, type, name, participants[], sides[], plannedMinutes }` |
| Show | `{ id, name, runtimeMinutes, items[] }` |
| Broadcast | `{ showId, status, results[] }` |
| Journal entry | `{ id, week, at, type, itemId, data }` |
| Grudge | `{ id, week, type, targetId, data }` |
| Memory | `{ id, week, source, weight, targetId, detail, fade }` |
| Thread | `{ id, a, b, startedWeek, lastWeek, events: [{ week, type, at }] }` |
| Incident | `{ id, kind, aggressorId, victimId, locationId, severity, demand, reach }` |
| Clock | `{ segmentMinutes, spent, pending: [minute] }` |
| Relationship | `wrestler.relationships[otherId] = { matches, segments, teamed, owed, tie }` |

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

## The look

A management desk rather than a monitor wall: cool slate panels on a deep navy
ground, **one saturated blue** doing all the work of "this is live, this is
yours, this is the thing to press", and the signal colours kept for things that
are actually signals — green for available, amber for the clock, red for
anything on the air or going wrong.

Everything reads from tokens in `:root`, which is why the identity could change
in one block rather than a thousand rules. `--cool` is the readable blue for
text and rules; `--accent` is the fill, which needs its own ink because white on
it is the point.

The header is three things: who you are, where you are, and when it is. The
wordmark sits in its own gradient block, the tabs are lit from the top edge
rather than boxed — which makes the row read as a place you *are* rather than a
set of things to press — and the right-hand block carries the week and the phase
over the promotion's name.

### The booking floor

Three panels across: **who you have, what you are making, and what you have
made.** The card gets the most room because it is the thing being built; the
roster takes the least because it is a reference you glance at.

The roster panel is new, and the point of it is that **clicking a row puts
somebody in the match you are building** — into the next empty seat, whichever
builder is open, and clicking them again takes them back out. Clicking their
*name* still opens their card, as it does everywhere else, which is why
`wrestlerLink` stops the click from reaching the row: otherwise one click did
two things.

Rows are one line each on purpose. An archetype under every name doubled the
height and put half the roster below the fold, which is the opposite of what a
reference list is for.

The three builders — match, bigger match, segment — used to be three stacked
panels. They are one panel with a segmented control now, which is both closer to
the shape of the screen and less to scroll past.

Only this screen takes the full width. Everything else is read rather than
operated and keeps a measure, because a locker-room list stretched across two
thousand pixels puts the name and the thing it says about them at opposite ends
of the desk.

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

Three things feed a relationship, and they work differently.

Most of it is **counted** off the card: people who keep meeting in the ring read
as rivals, people who keep standing together read as allies, and the game works
that out without being told. The rest is **named**, because it cannot be counted
into existence — a tag team is not two people with a high segment count, and
nobody is somebody's mentor because of arithmetic. Generation names a handful
once (a tag team or two, a mentor and their student, sometimes two people whose
lives are tangled up together, an old score from before you took the job, and
the faction the cult leader has been building) and everything downstream reads
the name.

And some ties are **formed** — the game watches a pair turn up for each other
often enough and names it without being asked. See *Ties form on their own*.

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

## Any shape of match

`participants` is the one list of who is in a match — everything from
whereabouts to morale to threads reads it — and **`sides` says how that list
divides**:

| `sides` | |
| --- | --- |
| `[1, 1]` | a singles match |
| `[2, 2]` | a tag match |
| `[3, 3]` | a six-person tag |
| `[4, 4]` | an eight-person tag |
| `[2, 1]` | a handicap match |
| `[1, 1, 1]` | a triple threat |
| `[1, 1, 1, 1]` | a fatal four-way |
| `[1] × 8` | an eight-way |
| `[2, 2, 2]` | a three-way tag |
| `[1] × 17` | a battle royal |

One list and one description of how it is cut, rather than two lists that can
disagree. A match used to carry a boolean `tag` and slice the participants at
index two, which is exactly why nothing bigger than four people could exist.
`teamsOf()` in `model/matches.js` is still the only place the sides are read
back, so the convention lives in one spot.

**The name is derived, never stored**, so a shape cannot be labelled one thing
and behave as another — and a shape you did not plan still gets its right name.
Leave one seat empty in a 2 v 2 and it is a Handicap match, because that is what
unequal sides are.

**Shape and stipulation are different things.** `sides` is the arrangement and
`matchType` is the rules, so a Fatal Four-Way Ladder Match is both, and the
label composes from the two. A battle royal is the one stipulation with no
natural limit on how many can be in it.

### What happens with more than two sides

Two things stop being the same question the moment a third side exists: who won,
and who the result goes against.

**Only one side takes the fall.** In a multi-way the other losing sides did not
win, which is a different thing and is not recorded as a defeat. Which side is
covered is weighted *inversely* to ability, so the least able side is the
likeliest — and never a certainty.

That is the whole reason to book one. **A fatal four-way is how you use somebody
without putting a loss on them**, which is exactly what multi-man matches are
for in real booking, and it falls out of the model rather than needing a rule.
Not winning still costs the ambitious ones something; it costs them a fraction
of a defeat.

A battle royal inverts it: nobody is pinned, so the name against the result is
whoever was still standing at the end — the strongest of the ones who did not
win.

**Ability decides less as the ring fills up.** The winner is a weighted draw
rather than a coin with a floor on it: `chaos` is how much the result stops
being about who is better, and it rises with the number of sides. A battle royal
declares its own, high. Eighteen people over the top rope is nearly a lottery,
and it should be.

**A singles belt can be defended in a fatal four-way or a battle royal**, and a
tag belt cannot — because a title held by *n* people needs every side to be *n*
people. That rule replaced a boolean comparison and got the multi-way case for
free.

### Booking one

The singles panel stays, because most matches are one against one and it is two
selects. Everything else goes through one builder: pick a shape (or *Custom*,
which takes a number of sides and a number each), and it renders a select per
seat, grouped by side with "vs." between the groups. The derived name updates as
you build, so the game tells you what you have made.

A battle royal drops the seats for a checklist of the whole roster with an
*Everyone available* button, because the whole point of one is that there is no
limit.

Bodies take time to get in and out of a ring, so **a shape has its own runtime
floor** — `3 + participants`, or `4 +` for a battle royal — taken against the
stipulation's. A seventeen-person battle royal wants twenty-one minutes, which
makes it a real claim on an hour show rather than a free spectacle.

Two things turned out to be broken underneath this and both predate it:

- **A scheduled match lost its shape.** `loadScheduled` copied participants and
  not the arrangement, so a six-person tag you advertised weeks ahead arrived on
  the card as a singles match between the first two names. The archive had the
  same hole.
- **`noteItem` recorded everyone in a match as everyone else's opponent.** Fixed
  for tag matches in the last tier; it now splits by the real sides, which means
  a battle royal correctly records that all seventeen of them met each other and
  a six-person tag records two teams of three.

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

## The bell is a moment

There used to be one question after a match — does the loser swing? — and one
coin to flip for it. The bell is a better moment than that: two people have just
had a match in front of an audience, and what they do in the ten seconds
afterwards is the most legible thing either of them does all night.

Eight outcomes, drawn from who those two specifically are. A weight of zero
means it is not a thing these two would do, which keeps a handshake out of a
blood feud and a faction beatdown out of a match between two loners.

| | Who does it |
| --- | --- |
| **Handshake** | two professionals with nothing between them |
| **Refused handshake** | one of them has the manners to offer; the other has the ego not to take it |
| **Stare-down** | history, and neither of them willing to be the one who swings |
| **Champion confrontation** | a champion in the building who was not in the match, and a plausible challenger who was |
| **Cheap shot** | somebody with the aggression for one shot and not the nerve for the rest |
| **Post-match attack** | a sore loser, or a winner making a point |
| **Hold kept on** | only in a submission match, and only by somebody vindictive enough to make a point of it |
| **Faction beatdown** | one of them has people in the back and the other does not |

**Most matches still end with two people walking to the back**, which has to
stay the commonest outcome or none of the others mean anything. About half
produce something, and of those the majority are colour.

That split matters: **only the four where somebody gets hurt stop the show.** A
handshake files a memory each way and nudges the record; a stare-down leaves
something on the table for next week; a champion walking down with a belt starts
a thread. None of them halt the broadcast, because none of them are the GM's
problem, and a show that paused for a handshake would teach the player to dread
the bell.

A hold kept on too long is the one that **injures somebody** — one to three
weeks, which is a problem for the next few cards rather than the end of a run.
Injuries end on their own; the only reason they sit apart from suspensions in
the code is that one of them is something you did to somebody.

## Five ways a reaction can go

The engine underneath had three outcomes. It now has five, and four of them are
somebody not helping.

| | |
| --- | --- |
| **Somebody goes** | and whoever comes as a unit with *them* comes too — a faction does not send a representative and then wait to see how it goes |
| **Somebody breaks it up** | no side to take. A pro with respect for the place walks between them, and it is over |
| **Somebody hesitates** | came out, thought better of it, went back. Worse than never moving, because they were seen deciding |
| **Somebody balks** | never moved at all — and their *reasons* were overwhelming. Nerve was the only thing that decided it |
| **Nobody moves** | nobody had a reason, and the closest thing to a friend gets remembered for it |

The last two are the same failure from different directions, and keeping them
apart is why `weigh()` returns the pull and the deterrents separately instead of
one number. A balk is rarer and lands harder, so a big enough pull beats
somebody merely wavering.

**Breaking it up is how a chain ends.** Before this, a chain stopped because a
counter ran out; now the locker room contains somebody whose function is to be
the adult, and it is a *race* rather than an override — a peacemaker heads off a
wrestler who was only just about to pile in, but anybody with a real reason goes
straight past them. Without that second half the adult in the room ended every
chain at the first opportunity, and escalation went to exactly zero.

Roughly: a save happens after a third of the times somebody gets jumped, and one
save in ten turns into a chain. Somebody walks between them about as often.

## Ties form on their own

Generation names a handful of relationships at the start, and until this tier
that was the whole list — everything afterwards was counts. But a pair who keep
turning up for each other are not "two people with a high segment count". At
some point they are a unit, and the game should be willing to say so.

Three things happen when the week turns.

**Shared enemies drift together.** Two people who both cannot stand the same
third person find they have something in common. Nobody decided it; it is what
happens in a locker room, and it is the quietest way a faction starts. Capped
below the ally bar, because having the same problem with somebody is not by
itself enough to make you a unit.

**Closeness is scored, not checked.** `segments + teamed × 2 + owed × 4`, and
past a threshold with warmth both ways the game names it — a tag team if they
keep being booked as a team, allies if they have only ever stood beside each
other. The first version wanted five shared segments *and* a debt *and* mutual
warmth: three uncommon things at once, which is why nothing ever formed.

**Three mutually tied people become a faction**, one at a time, because a roster
of factions is a roster of nothing. The reaction engine then treats them as a
unit, which is the whole difference between three allies and a faction that
arrives together.

Two bugs turned up here and both were older than this tier:

- **Tag partners were being recorded as each other's opponents.** `noteItem` gave
  `matches` to everyone in a match, so your own partner read as a rival you kept
  meeting. Same side is time spent together now, and the team-up is counted
  separately — two people booked as a team six times are a team, and nothing
  else in the record says that as plainly.
- **Everything that happened between shows was invisible.** `advanceWeek` files
  its events with the new week's number, and `startShow` was clearing the
  journal wholesale — so a tie forming, a promise going cold and an opportunity
  going stale were all written and then thrown away before anybody could read
  them. This week's entries survive into the night now.

## What the game noticed

Every tier underneath this produces events between two people: a match, an
attack, a save, somebody standing there when they were needed. On their own they
are a feed. Read together they are a feud, and nobody wrote it.

A **thread** is a pair and their running record. It steers nothing — it is a
*reading* of what has already happened, kept so the aftermath can say "this is
building" without the player holding forty journal lines in their head. Each
event carries a weight, and the ones that go the other way subtract: a handshake
or a save quietens a thread rather than feeding it, so two people can stop being
a feud without anything having to delete them.

The panel names the sharpest thing in each, which is what the story is actually
about: *three things between them, nothing for four weeks. Where it turned: one
of them was left standing there alone.*

Two labels were wrong on the first pass and both were the same mistake — a
reading that says the same thing about everything says nothing. "The story of
your show" went to five pairs at once, so it is now exclusive to the hottest
thread and only when it has earned it; and "fourteen weeks of it" was true of
almost every thread, so the line counts the events and their recency instead.
The event cap had to go up too: pinned against a ceiling of twelve, every
established pair reported "a dozen things" and the count stopped telling them
apart — the same saturation that had already broken the memory ledger.

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
two participants; they became two sides, and are now any number of sides of any
size — see *Any shape of match*. `teamsOf()` in `model/matches.js` is the only
place participants are split, so the convention lives in one spot, and
`decideWinner()` returns the winning *side* rather than one name.

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

## The backstage layer

This is the tier where it stops being a booking screen. The GM is a person in a
building, and the building is ten rooms:

```
            Interview ── Production
                 │            │
Medical ── Locker room ── Hallways ── Gorilla
                 │            │
             Catering     GM office
                              │
                          Security ── Parking lot
```

Two minutes a corridor. The hallways are the hub — two minutes from the curtain,
your office, the locker room and the truck, and the worst place in the building
to be standing, because you see everything pass and control none of it. The car
park is eight minutes from Gorilla, which is most of a match, and that is the
whole reason presence is a decision.

### The clock is the match

However long the item on air runs is however long you have backstage before the
next one starts. **Thinking is free; acting costs clock.** Reading the room,
looking at who is where, weighing it up — none of that moves the clock. Walking
does. Talking does.

So a card of five-minute matches is a night with no room to manage anybody, and
a twenty-minute main event buys you the walk to the car park and back. Booking
and presence turn out to be the same decision seen from two ends, which is what
makes the earned window worth more than minutes.

The trouble in each gap is decided **up front, from how long the gap is** — not
from what you do with it. Whether you spend the twenty minutes crossing the
building or standing at the curtain, the same night happens. All your choice
changes is which of it you are in the room for. (The first version tied
incidents to the GM's own actions, which quietly made standing still the winning
strategy. That is the opposite of the point, and the simulation caught it.)

### Where everybody is

Anyone in the next item is already at the curtain; anyone in the one on air is
either out there or coming back through it. Everything else is a read on the
person — the ones who want to be seen stand where they will be, the injured one
is in medical, and somebody unhappy and out for themselves is sitting in their
car, which is the furthest room from you and the point of it. Named ties pull
people together, so a tag team is in the same room without either of them having
chosen it separately. About a third of the room moves between segments.

### Witnessed, heard, missed

Three answers, and the middle one is the interesting one.

| | |
| --- | --- |
| **Witnessed** | You are in the room. The show holds and asks you. |
| **Heard** | Next door, or two rooms away if it is loud. You know something is going on and roughly where, but not what — and going to look costs the walk. |
| **Missed** | You find out in the aftermath, or not at all. |

**Everything resolves whether you are there or not.** The locker room reacts on
its own, memories file, grudges form. You simply do not get to rule on it — and
not having ruled on it is itself something the room notices. That is the
difference between a game about presence and a game about menus.

Going to look is not the same as being there: **a ruling that arrives late is
worth half a ruling**, because the room had already worked out that nobody was
coming. And an alert expires when the segment does. You had the length of a
match to walk down the corridor and you spent it on something else.

One exception, and it is a fair one: a post-match attack **went out on
television**. Wherever you were standing, you know, and it is as much a
broadcast problem as a backstage one — so that is the only kind of incident
presence cannot make you miss.

### What it costs to miss something

Most misses cost you the ruling and a little standing. Two cost more:

- **Somebody refusing to go out**, with nobody at the curtain to make them, takes
  the segment off the card. Minutes of nothing, and a hole in the rundown the
  executives lead with.
- **Somebody walking out**, with nobody in the car park, means they drive off.
  Three weeks, and they come back carrying it.

### Talking to people

Finding somebody and hearing them out costs two minutes and buys two things:
they remember that you came looking, and you learn them faster than booking them
would. Once each per night — the second conversation in an evening is not a
conversation.

And being *seen* counts on its own. Anybody who laid eyes on you tonight reads
that as the job being done; anybody who never did forms a view about that.
Touring the building is worth the minutes even when nothing is going wrong,
which is what stops "stand at Gorilla all night" from being free.

## Ten kinds of trouble

Each kind finds its own people and its own room, and a kind with nobody to pick
simply does not happen — which is what makes a settled roster genuinely quiet
rather than uniformly noisy.

| | Where | What it takes |
| --- | --- | --- |
| **Argument** | wherever two of them are | history, or a grudge |
| **Brawl** | same | that, plus somebody who does not stop at shouting |
| **Ambush** | wherever the victim is | a grudge, and the nerve to go looking |
| **Attack** | on camera | the bell, and a sore loser |
| **Complaint** | your office | unhappy and ambitious enough to ask |
| **Storming in** | wherever you are | past asking |
| **Confrontation** | wherever you are | a grievance with the office, said out loud |
| **Refusing to go out** | the curtain | booked next, furious, and not professional enough to swallow it |
| **Walking out** | the car park | furious, disloyal, and holding something against you |
| **Tag team / faction falling out** | wherever they are | a named tie where one of them is doing much better than the other |

Where it happens is not decoration. A confrontation in an empty office is a
conversation; the same words in the locker room are an event, and everybody
standing there files it. And the reaction engine only considers **who is
actually near enough**: something on camera is on every monitor in the building
so the whole roster can come through the curtain, but something in a corridor is
seen by whoever is in that corridor and heard by the room next door, and that is
the entire list. Which is why "nobody moved" is common backstage and rare on
television, without either being a tuned number.

## The show stops and asks

An incident is a situation, not a verdict. The locker room reacts on its own —
that happens in the moment — and then the show **holds** until the GM answers.
Complete Segment is disabled until they do, and the pending incident lives on
the save, so closing the tab does not get you out of it.

Fourteen answers, from "let them settle it" to an indefinite suspension. Each
carries a `weight`, and every incident carries a `severity`, and **the room
judges the gap**:

| | |
| --- | --- |
| **harsh** | response much heavier than what happened — the punished wrestler holds it against the office, and so do their close allies |
| **fair** | it fit — the victim is satisfied |
| **weak** | you let it go — the victim takes it badly and every professional on the roster notices |

That comparison is why discipline is judgement rather than a button marked
"harshest". A month off for a shouting match and a month off after a
locker-room riot are the same click and completely different decisions.

### The ladder

Suspensions are a ladder rather than a set of buttons, so the rung you reached
for is legible next to the ones you did not:

| | |
| --- | --- |
| Sent home for the night | Off the rest of the card. Back next week. |
| One week | They miss next week. |
| Two weeks | Long enough that the card has to be rebuilt around it. |
| One month | They will have time to think about you. |
| **Indefinite** | No end date. **It does not run out — you end it, from the roster screen, or it does not end.** |

Every other length expires on its own. That is exactly what makes the top rung
different: an indefinitely suspended main eventer is a hole in your card every
week until you decide otherwise, and the roster screen will keep saying so.

Any suspension **pulls the wrestler off the rest of tonight**, including
whatever they were booked for, so a heavy call costs you television.

### The three ways of not deciding

They are not the same failure, and the record counts them apart:

- **Let them settle it.** A decision. The room saw you make it.
- **Deal with it later.** A deferral. It comes back after the next segment, one
  severity step heavier, and wherever you happen to be standing then.
- **Give them what they want.** Solves this one completely, and tells the
  building how to get what it wants. Everybody in the room watches you fold.

Only demands can be conceded, and what conceding *does* depends on the demand: a
promise you now have to keep, a spot somebody else no longer has, or a wrestler
you will not see for eight weeks.

**Security is two people for a whole building.** Sending them is spending them,
and the next thing tonight finds out.

## Authority, and what head office thinks

Two standings, and they are not the same thing — a locker room can be terrified
of you while head office remains unconvinced.

**Authority** is whether your word carries. Built from the pattern of your
rulings rather than a stat you spend: following through raises it, and the ways
of avoiding a decision take it down — giving in hardest, then ignoring, then
deferring, then not being in the room. It is expressed as a *share* of the calls
that came your way rather than a running sum, so it converges on how you tend to
be read instead of climbing forever, and a GM forty weeks in is not automatically
worse than one four weeks in.

It is not a penalty applied to a number. **It is a reason things happen**: low
authority multiplies how often the building gives you trouble, and specifically
how often somebody refuses to go out or walks to their car. The loop closes.

Four ways of doing the job, over twenty-five simulated weeks each:

| | Authority | Head office | Locker-room morale | Walkouts |
| --- | --- | --- | --- | --- |
| Always a formal warning | 69 | 67 | 45 | 1 |
| Never leaves the curtain | 56 | 53 | **40** | 4 |
| Walks the building, rules ad hoc | 54 | 54 | **48** | 0 |
| Always gives in | **13** | **2** | 41 | **13** |

Standing at Gorilla all night keeps your authority intact and costs you the
locker room. Giving in costs you everything. Neither is a bug.

## Unfinished business

Anything left unresolved becomes an opportunity on the booking screen: book it,
or leave it. "Book it next week" records it as a **promise**, and a promise that
goes unkept is a grudge. Everything goes cold after three weeks, and the person
who was wronged notices that nothing was ever done.

## GM reputation

Nobody picks this at the start. `gmRecord` counts every call by how the room
read it, and a pattern earns a name — The Disciplinarian, The Absentee, The
Matchmaker, The Wild West GM, or an even hand. It shows on the post-show.

## The GM board

`gmReputation()` names the GM you turned out to be. The board is where you get
a say in it.

Seven branches — Authority, Locker Room, Booking, Production, Corporate,
Scouting, Negotiation — 113 upgrades between them costing 269 points, against
roughly 97 you will earn by the level cap. You will own about a third of it.
The whole design is [`docs/gm-progression.md`](../docs/gm-progression.md), and
`data/upgrades.js` is generated from that document.

**Sixteen of them are built.** The rest are drawn on the board greyed out,
because a tree you cannot see the end of is a list. Clicking any node — built
or not — dims the board and lights only the path to it, with what the whole run
costs from where you are standing.

### XP is for running the building

Not for producing good television. Every ruling pays, weighted by how the room
read it (fair 18, harsh 12, weak 6, gave in 4), with six more on top for
anything you saw happen yourself rather than heard about — which makes standing
in the right room the most repeatable XP in the game. Ties forming, title
changes, an on-time show, a filled window, a broad card and a night where every
wrestler laid eyes on you all pay.

The network's grade is in there and is capped hard, at about a seventh of a
strong week. The moment grade dominates XP the best play becomes booking your
two best workers every week and ignoring everybody else, which is the game this
one is specifically not. **XP never goes backwards** — a bad night already
costs trust, authority and morale, and taking XP as well would punish one
mistake three times and teach you to stop experimenting.

XP is read off the journal once, when the show comes off the air. One source of
truth, and it survives a migration.

### What the tree took away

Two things that used to be free are now bought:

**Every match shape past one against one.** A new GM books singles matches. Tag
teams, triple threats and fatal four-ways are the first three things on the
Booking branch, and the submission stipulation is the fourth. This is on
purpose: the most useful thing a new GM can learn is that in a multi-way only
one side takes the fall — booking somebody into one is how you *use* them
without *beating* them — and that lands much harder as an unlock than as an
option that was always in the dropdown.

**Length and belts.** `awardTrust()` no longer promotes you. Trust makes a rung
on the broadcast ladder *available*; a point is what takes it. Head office
offering you ninety minutes and you taking ninety minutes are two decisions,
and the second one competes with everything else on the board.

Saves written before the tree existed are granted the Booking upgrades
outright, along with the rungs and belts they had already been promoted
through, and keep every point their level would have earned. Taking something
away from a GM who has been doing it for thirty weeks would be a bug wearing a
design's clothes.

### Who you are allowed to team

A ladder that relaxes as you buy it. At level one you can only put two people
together who already work as a unit — a named tie, or `rapport` of six.
`rapport()` counts matches against each other as well as segments beside each
other, deliberately unlike `closeness()`, which counts only same-side work:
gating a pair's first tag team on closeness would be asking them to team before
they were allowed to team. The roster generator seeds a tag team or two who
were a unit before you arrived, so there is always somebody legal on day one.

Working Relationship drops the bar to three. Just Get Along asks only for
warmth. Forced Partnership removes it, and forcing an incompatible team stays
risky for good.

### Reading people is a purchase

The card used to break down what was on a wrestler's mind for free. Now
**Know Your Locker Room** buys it — without it you can see the mood and would
have to ask what is behind it. **Read The Grudge** turns "three open grievances
with the office" into what each one is actually about. **Paper Trail** shows
the warning file, which is kept whether or not you can read it. **Read The
Room** puts a reading on each response button before you commit — and is wrong
about one time in five, and wronger on somebody you have never worked out,
because judgement is the game and a reliable preview would be a lookup table.

Scouting does not invent a second way of knowing people. `model/stats.js`
already turns familiarity into readings that sharpen over time, so
**Background Check** buys familiarity — a week of asking around is worth a
season of working together — and **Tape Study** sharpens ability only. You can
watch somebody wrestle without ever meeting them; it tells you nothing about
whether they hold a grudge.

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
