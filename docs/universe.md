# WWE 2K Universe — data layer

Event-sourced store for a Universe mode save: wrestlers, brands, championships,
tag teams and factions, plus every match, attack, promo, title change, injury,
contract and transfer that happens to them.

Two front ends over one data layer: the dashboard at `universe.html`
(`dist/universe.html` to open without a server) and the CLI at
`tools/universe.mjs`. `js/universe/` itself is DOM-free — it knows nothing about
either.

```
js/universe/
  schema.js    event types, entity shapes, effect vocabulary, validation
  store.js     the three logs, append / amend / void, storage adapters
  project.js   the fold — replays events into current state
  seed.js      load a universe from JSON
  pyramid.js   tiers, what is above and below a brand, where movement lands
  draft.js     the annual draft — order, board, commit
  season.js    season windows, standings, promotion and relegation
  prompts.js   copy-paste prompts with state embedded
  ingest.js    screenshots in — transcription prompt, optional vision call
  roster.js    paste a roster, diff it, print who is on each brand
  card.js      type a show's card in shorthand
  util.js      name resolution and plain-text tables
  seed-data.js generated from data/universe-seed.json for the browser build
  ui/
    app.js     boot, tabs, actions — the only file that touches storage
    views.js   roster, belts, threads, profiles, log — projection in, HTML out
    entry.js   the card and roster boxes, with live previews
    dom.js     escaping, tables, delegated events
    tools.js   the prompt and import panels, and the clipboard
universe.html  the dashboard page
tools/
  universe.mjs           the CLI
  universe-check.mjs     291 data-layer checks, pure Node
  universe-ui-check.mjs  170 browser checks against the built page
  build-universe-seed.mjs regenerates seed-data.js from the JSON
data/
  universe-seed.json     example seed
```

## The idea

Everything that happens is an event. Events are append-only and immutable.
Current state — who holds a belt, who is on which brand, win/loss records, who
is aligned with whom — is **never stored**. It is folded out of the log on
demand:

```js
const state = project(store);          // now
project(store, { asOf: '2026-01-01' }); // any point in history, same code path
```

Correcting a mistake is therefore one small append to the correction log, and
every downstream number recalculates on the next read. There is no cache to
invalidate and no half-updated state to repair.

### The one invariant

> An event's `effects` must be a pure function of its own `participants` and
> `data`. Never look at surrounding state when building them.

An effect that baked in a fact about the world at write time ("the belt moves
*from Cody* to Roman") would go stale the moment an earlier event was voided.
So effects state only what the event asserts ("the belt is now on Roman") and
the projector works out consequences against whatever state the replay has
reached. Void the match where Cody won the belt and every later reign still
lines up.

The write-time question "*did* the title change hands here?" is a question for
the author — `card.js` answers it by looking at current state and records the
answer in `data.titleChanged`.

## Entities

The registry answers *who exists*. It deliberately holds no brand, status,
title, record or membership — all of those move with time and belong to the log.
A seed file may write `brand` and `status` for convenience; the seeder turns
them into events and drops them before storing the record.

| Kind | Id | Fields |
| --- | --- | --- |
| `wrestler` | `w:roman-reigns` | name, gender, alignment, debut, aliases, overall |
| `brand` | `b:raw` | name, abbr, color, logo, tier, day, parentId |
| `championship` | `c:wwe-championship` | name, brandId, division, teamSize, activeFrom, retiredOn |
| `group` | `g:the-bloodline` | name, kind (`tagTeam` / `faction` / `alliance`), memberIds, leaderId, brandId |

Tag teams and factions are the same entity with a different `kind`, so the
alliance events work on both without special cases.

## Events

Envelope:

```jsonc
{
  "id": "ev_0081", "seq": 81, "type": "match", "date": "2026-08-17",
  "showId": "sh_0080", "cardOrder": 1,
  "participants": [ { "ref": "w:damian-priest", "role": "winner", "side": 1 } ],
  "data": { "matchType": "steel cage", "titleId": "c:world-heavyweight-championship", "titleChanged": true },
  "effects": [ { "kind": "record.win", "subject": "w:damian-priest" } ],
  "note": "", "source": "card-entry", "causeId": null, "createdAt": "..."
}
```

`side` groups participants into corners: same side = partners, different side =
opponents. Ordering is `(date, seq)`, so several matches typed in on one night
stay in the order they were typed.

| Type | Participants | Key `data` | Effects |
| --- | --- | --- | --- |
| `show` | — | name, brandId, ple (`wrestlemania`, `lastStand`, …) | `show.open` |
| `match` | competitor / winner / loser | matchType, decision, titleId, titleChanged, interim, unify, contender, stakes, toBrandId | `record.*`, `title.award` / `defense` / `interim` / `unify`, `alliance.bond`, `rivalry.heat`, `thread.open` |
| `attack` | attacker, victim | context | `rivalry.heat`, `thread.open` |
| `promo` | speaker, target | topic | `rivalry.heat` |
| `save` | subject, victim, attacker | context | `alliance.bond`, `rivalry.heat`, `thread.close` |
| `alliance.formed` | member, leader | groupId, groupKind, name | `group.form`, `group.join` |
| `alliance.broken` | member | groupId, dissolve | `group.leave`, `group.dissolve`, `thread.open` |
| `title.change` | champion | titleId, reason | `title.award` / `vacate` / `interim` / `unify` |
| `injury` | subject | severity, weeks, expectedReturn | `injury.start`, `roster.status`, `thread.open` |
| `injury.cleared` | subject | status | `injury.end`, `roster.status` |
| `contract.signed` | subject | brandId, expires, terms | `contract.start`, `roster.brand`, `roster.status` |
| `contract.expired` | subject | reason, released | `contract.end`, `roster.brand`, `roster.status` |
| `brand.transfer` | subject | toBrandId, reason, status | `roster.brand` |
| `status.change` | subject | status, reason | `roster.status` |
| `thread.open` | subject, target | threadKind, about, text | `thread.open` |
| `thread.resolved` | — | threadId, reason | `thread.close` |

`title.change` reasons: `won`, `awarded`, `vacated`, `stripped`, `retired`,
`interim`, `unified`.

Everything beyond the original brief — `show`, `injury.cleared`,
`status.change`, `save`, the two `thread.*` types, and the vacate path on
`title.change` — exists because the log would otherwise have no way to end an
injury, clear a promotion flag, group a card, credit a run-in, close a question,
or empty a belt.

A title won in a match is **not** also written as a separate `title.change`. The
match already carries the `title.award` effect, so correcting the winner moves
the reign with it; a second linked event would survive that correction and leave
the belt on the wrong wrestler. `title.change` is for changes outside a match.

`brand.transfer` does not touch the roster flag unless `data.status` says so. A
promotion that auto-cleared the promotion flag would fight a re-pasted roster
that still reads `promotion`, and the import would never settle.

### Effects

`record.win` `record.loss` `record.draw` · `title.award` `title.vacate`
`title.defense` `title.interim` `title.unify` · `roster.brand` `roster.status`
`roster.align` · `contract.start` `contract.end` · `injury.start` `injury.end` ·
`group.form` `group.join` `group.leave` `group.dissolve` · `rivalry.heat`
`alliance.bond` · `thread.open` `thread.close` · `show.open`

`project.js` has one handler per kind, so adding an event type usually means
reusing these rather than growing the list. (`feud.heat` is the old name for
`rivalry.heat`; the projector still accepts it so saves written before the
rename replay unchanged.)

## The pyramid

A universe is a stack of tiers, not a hardcoded Raw/SmackDown/NXT. `tier` is an
ordinary number on the brand record — 1 is the top, there is no maximum, and
several brands share a rung. The default seed is:

    Raw | SmackDown | Dynamite  ↓  NXT  ↓  Evolve

but that is only what the seed file says. Another save can run

    Raw | SmackDown  ↓  NXT | WCW  ↓  Evolve

and a third can have six rungs. **Nothing in the code names a brand.** Promotion,
relegation, Last Stand pairing and the draft all ask `pyramid.js` what is above
or below a brand and act on the answer, which is why adding a tier 4 makes the
old bottom rung start relegating with no code change.

| Field | What it does |
| --- | --- |
| `tier` | which rung, 1 at the top. Numbers need not be consecutive |
| `parentId` | optional "develops for" link — send Evolve's promotions to NXT specifically |
| `day`, `logo`, `color`, `abbr` | how the show presents itself |

Movement resolves in this order: the parent link if it points the right way, then
a brand on the neighbouring tier that names this one as its parent, then the
thinnest roster on that tier — which keeps rosters from drifting apart over a few
seasons. A tier-1 brand has nowhere to be promoted to and the bottom rung has
nowhere to be relegated to, and both return null rather than inventing a
destination.

The **Pyramid** tab draws it, and creating or editing a show there is a form:
name, short name, logo, colour, tier, show day, and who it develops for. Invalid
shapes are refused with a reason — tier 0, a nameless show, or a parent on the
same rung or below, which would let movement loop.

    node tools/universe.mjs pyramid
    node tools/universe.mjs brand "WCW" --tier 2 --day Saturday --color '#C0392B'

## Championships

**Every championship in a new save is VACANT.** Nothing is pre-assigned from
real-world champions, on any brand or any tier, and a belt's history begins the
first time somebody wins it inside your save — so reign 1 of the WWE
Championship is whoever *you* crowned. A championship created later starts
vacant too, because a belt only has a holder once a `title.award` effect has put
one there. The UI says `VACANT` rather than trying to show a champion.

(A seed file may still include a `titleHolders` block if you deliberately want a
save to start mid-reign. The shipped seed has none.)

A belt carries a brand, a division and a lineage. Winning one closes the
previous reign with its day count and opens a new one — that is a plain
consequence of `title.award`, so it happens the same way whether the belt moved
in a match, was awarded off-screen, or moved because you *corrected* a match
you had entered wrong.

**Choosing the champion.** Two places, because there are two situations:

- *In the card preview*, a title match shows its outcome as a **button**, not a
  verdict. The default is inferred from who won — right nearly always — and one
  click flips it. Clicking rewrites the line itself (`(new champion)` /
  `(retains)`), so the override is visible in what you typed, survives the next
  keystroke, and is not hidden in some toggle you will forget about.
- *On a belt's page*, **Set the champion** names a holder outright with no match
  at all — for when the game handed a belt over off-screen, or the seed guessed
  wrong. Two names joined with `&` for a tag title, plus **Set interim** and
  **Vacate**. It writes an ordinary `title.change`, so the previous reign closes
  with its day count and voiding the event hands the belt straight back.

**Vacating** (`vacate:`, `strip:`, `retire:` on a card) closes the reign and
leaves the belt empty. It also opens a thread, because a vacant belt is the most
open question there is; crowning the next champion closes it.

**Interim titles** run a *parallel* reign rather than a second belt. Both the
real reign and the interim reign are open at once, each with its own defense
count, and both appear in the lineage marked accordingly. Defenses land on
whichever reign the defending champion holds. Unification (`unify`) closes both
and opens one undisputed reign, so the interim run stays in the history with
`endReason: unified` instead of being erased.

A **number-one contender** match (`contender`) names a belt without being for
it: the title moves to `data.contender`, the match is not a title match, and the
winner is owed a shot — which the threads queue then tracks.

## Relationships

Derived, never entered. Every tie is the sum of its contributions, each decayed
from its own date:

    heat = Σ points × 0.5 ^ (age_in_days / half_life)

| Builds rivalry | | Builds alliance | |
| --- | --- | --- | --- |
| attack | 3 | alliance formed | 4 |
| betrayal (attacking a stablemate) | 5 | tag win | 2 |
| promo | 2 | tag loss | 0.75 |
| decided match | 1.5 | save | 3 |
| draw | 0.75 | | |
| title on the line | +1 | | |
| making a save (vs the attacker) | 2 | | |

Half-lives are 60 days for rivalry and 90 for alliance; below a heat of 2 a tie
stops counting as `active` but keeps its history. Because decay is measured
against the projection's `asOf`, moving the date box back in the dashboard shows
the heat as it stood then — nothing is recomputed on a timer.

**Propagation.** An attack also lands on the victim's tag partner and faction
members, at `0.35` of the direct weight. This is done in the projector, not in
the effect, because who someone was standing with is a fact about the world at
that moment — an effect that baked it in would be wrong as soon as an earlier
event was corrected. The same lookup is what turns an attack on a stablemate
into a betrayal.

## Threads

The queue of questions the log has opened and not answered. Threads are derived,
with stable ids (`th_<opening event id>`), so voiding the event that opened one
removes it.

| Opens | Closes when |
| --- | --- |
| an attack | the victim beats or attacks them back, or someone makes the save |
| a betrayal (`alliance.broken`, or attacking a stablemate) | the two meet in a match |
| a contender win, or `promise:` | they get the match, or win the belt |
| a vacated belt | a new champion is crowned |
| an injury | `cleared:` |
| `thread:` — anything you want to track | you mark it resolved |

Marking one resolved appends a `thread.resolved` event rather than flipping a
flag, so it sits in the log, and voiding that event reopens the thread.

    node tools/universe.mjs threads
    node tools/universe.mjs resolve th_ev_0073 "dropped it"

## Corrections

One append-only log covers both events and entities:

```jsonc
{ "id": "cx_0001", "at": "...", "target": "event", "targetId": "ev_0081",
  "op": "amend", "patch": { "participants": [...] }, "note": "misread the result screen" }
```

- **amend** merges the patch into the raw event and **re-runs it through its
  type's effect builder**, so a corrected event never keeps the consequences of
  what was originally typed. `data` merges key by key (`null` clears a key);
  `participants` is replaced wholesale.
- **void** drops an event from every projection while leaving it in the log.
- **restore** puts it back. Last op wins.

Amendments are validated against the merged event, so a correction that would
produce an invalid event is refused before it reaches the log.

```
$ node tools/universe.mjs amend ev_0081 winner="Gunther" --note "misread the result screen"
```

Before: Priest 1-0, two reigns on the World Heavyweight Championship.
After: Priest 0-1 on a 1L streak, Gunther still champion since 2026-01-27, one
continuous reign, one more successful defense. Nothing was updated — it was
replayed.

## Storage

```jsonc
{ "meta": { "version": 1, "name": "Universe 2026", "seq": 89, "cxSeq": 1, "startDate": "2026-06-01" },
  "entities": { "wrestlers": {}, "brands": {}, "championships": {}, "groups": {} },
  "events": [], "corrections": [] }
```

A storage adapter is two methods, `load()` and `save(doc)`:

```js
new UniverseStore({ adapter: memoryAdapter() })        // tests
new UniverseStore({ adapter: localStorageAdapter() })  // browser, key arc_universe_v1
new UniverseStore({ adapter: fileAdapter(path) })      // Node — defined in tools/universe.mjs
```

The file adapter lives in `tools/` so `js/universe/` stays free of `node:`
imports and can be bundled for the browser untouched.

`appendBatch` is all-or-nothing: a card that fails validation halfway through
leaves nothing behind.

## Seeding

Seed files are written in **names**, not ids, and are resolved on the way in:

```json
{ "name": "Universe 2026", "startDate": "2026-06-01",
  "brands": [{ "name": "Raw", "color": "#c8102e" }],
  "championships": [{ "name": "WWE Championship", "brand": "SmackDown", "division": "mens" }],
  "wrestlers": [{ "name": "Cody Rhodes", "brand": "SmackDown", "gender": "male", "alignment": "face" }],
  "tagTeams": [{ "name": "#DIY", "members": ["Johnny Gargano", "Tommaso Ciampa"] }],
  "factions": [{ "name": "The Bloodline", "members": ["Solo Sikoa", "Jacob Fatu"], "leader": "Solo Sikoa" }],
  "titleHolders": [{ "title": "WWE Championship", "holders": ["Cody Rhodes"], "since": "2026-04-06" }] }
```

Seeding does not write "initial state" — there is no such thing here. It writes
*founding events*: a contract for every wrestler on a brand, an
`alliance.formed` for every team and faction, a `title.change` for every reign
already in progress. Day one is ordinary history, so a wrestler added by mistake
can be voided like anything else.

```
node tools/universe.mjs seed data/universe-seed.json --fresh
```

## Roster import

Paste the roster; the parser classifies each field by what it *is* rather than
where it sits. All of these are the same wrestler:

```
Rhea Ripley, Raw, female, active
Rhea Ripley | f | RAW
Rhea Ripley (female) - active
```

Under a `RAW` section header the brand can be left off entirely. Recognised
statuses: `active`, `relegation` / `rel` / `down`, `promotion` / `callup` /
`up`, `fa` / `free agent` / `unsigned`, `injured`, `released`. Groups:

```
Tag Teams
The War Raiders = Erik & Ivar
Faction: The Judgment Day = Finn Bálor, JD McDonagh, Dominik Mysterio
```

Import is a **sync, not an insert**. It diffs the paste against current state and
writes only the events that account for the difference — a contract for someone
new, a `brand.transfer` for someone who moved, a `status.change` for a new flag.
Pasting the same roster twice writes nothing the second time, so it is safe to
re-paste the whole list after every draft.

A partial paste only touches the people in it; nobody is removed for being
absent. Gender and alignment are registry facts, so they are written as entity
corrections rather than events.

```
node tools/universe.mjs roster roster.txt --dry     # preview
node tools/universe.mjs roster roster.txt
node tools/universe.mjs brands
```

## Card entry

```
Monday Night Raw / 2026-08-17 / Raw
Damian Priest d. Gunther — World Heavyweight Championship, steel cage
The War Raiders d. Alpha Academy (tag, World Tag Team Championship)
Rhea d. Liv (submission)
Seth Rollins d. Sami Zayn, Bron Breakker — triple threat
Becky Lynch vs Ivy Nile (dq)
* Solo Sikoa attacks Cody Rhodes after the main event
Seth Rollins promo on Roman Reigns — contract signing gone wrong
injury: Sami Zayn (6 weeks, knee)
```

| Shorthand | Meaning |
| --- | --- |
| `d.` `def.` `beat` `over` `>` | winner on the left |
| `vs` | no winner — give a finish (`draw`, `no contest`, `dq`, `countout`) |
| `&` `+` | partners — same corner |
| `,` | another corner — triple threat or worse |
| `(...)` or after a dash | stipulation, finish, title, free note |
| `*` | a non-match segment |
| `interim` / `unify` / `contender` | modifiers on a title match |
| `X saves Y from Z` | a run-in |
| `vacate:` `strip:` `retire:` `cleared:` | one-line title and injury changes |
| `promise:` `thread:` | open a thread by hand |

Names are matched loosely — id, full name, alias, surname, prefix, substring —
and stop at the first rung that gives exactly one answer. Two answers is an
error listing both, never a guess. A tag team or faction name expands to its
current members, so `The Usos d. Judgment Day` is a legal tag match.

Match type is inferred from the shape of the corners, and whether a title
changed hands is inferred by comparing the winners against the current champion
— `(retains)` or `(new champion)` override it.

```
node tools/universe.mjs card card.txt --dry    # always preview first
node tools/universe.mjs card card.txt
node tools/universe.mjs card -                 # paste, then ctrl-D
```

## Dashboard

```
npm start                    # then http://127.0.0.1:8080/universe.html
npm run build                # then open dist/universe.html directly
npm run check:universe-ui    # 170 browser checks
```

| Tab | What it does |
| --- | --- |
| Tonight | Type a card. The right-hand pane shows what the parser heard, updated on every keystroke; the save button stays disabled while anything is wrong. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves. Below it: active rivalries, active alliances and the oldest open threads. |
| Roster | Paste box (collapsed) over a table per brand, plus free agents and every team and faction. |
| Pyramid | The tier diagram, and the form that creates or edits a show. |
| Titles | Every belt with holder, interim holder, days, defenses and reign count. Click one for its own page: full lineage with day counts, interim runs marked, and every match it has been on the line for. |
| Threads | Open questions, oldest first, with how long each has been sitting. Resolve one and it appends an event. Recently closed threads underneath, with what closed them. |
| Season | Standings per brand for the season in progress, the promotion and relegation lists, a one-click Last Stand card, and the draft board for each tier. |
| Shows | Every saved card, newest first. |
| Log | Every event and every correction. Open a match to fix a wrong result; void or restore anything. |
| Prompts | Five copy-paste prompts with the current state embedded. |
| Import | Drop screenshots of a card or a roster and turn them into events. |

Clicking any wrestler's name opens their profile: record, win rate, streak,
title reigns with day counts, rivalries and alliances sorted by heat, open
threads they are part of, and a timeline of every event they appear in.

The whole page is a function of the projection: an action appends to the log,
then everything redraws. That is why fixing a result in the Log tab moves the
records on the Roster tab and the holder on the Titles tab with no further
work — there is no second copy of the truth to update.

**State as of** in the header re-projects the entire page at a past date, using
the same `project(store, {asOf})` the CLI uses.

Storage is `localStorage` under `arc_universe_v1`, seeded from `seed-data.js` on
first load. The fantasy app's keys are never read or written. If a write fails
(quota, private mode) the page says so rather than pretending it saved.

## Seasons, promotion and relegation

A season runs **from one Last Stand to the next**, because Last Stand is where
the brand moves happen. Before the first one, the season starts at the
universe's start date. Seasons are derived from the log like everything else —
there is no season record to keep in step, and voiding a Last Stand merges the
two seasons either side of it back into one.

    ... regular shows ...   WrestleMania  →  the lists go up
                            Last Stand    →  flagged names fight, brands change
                            next season

Both are recognised from the show's name, so `WrestleMania 43 / 2027-04-04 / Raw`
needs no extra marker (`PLE: lastStand` in the header forces it).

**Standings** are win totals inside the season window — 3 points a win, 1 a
draw — ordered by points, then win rate, then matches wrestled. That last
tiebreak matters: among a group all sitting on zero, the one who was barely
booked sinks to the bottom rather than whoever comes last alphabetically.

**The lists.** After WrestleMania, `proposeFlags` reads the pyramid: every brand
with a rung beneath it puts its bottom names on the relegation list, every brand
with a rung above it puts its top names on the promotion list, **per gender**,
because the matches are. On a three-tier pyramid the middle rung does both — NXT
names go up to tier 1 and down to Evolve in the same year.

The lists are then **balanced to an even number** per tier, per gender, per
direction. These names exist to face each other, so an odd list leaves somebody
with no opponent, and pairing across a tier or a gender would change what the
match is for. Where a tier has several brands the safest name is spared; where it
has only one there is nobody to spare against, so the next name down is called up
instead. Without this a three-brand tier flags three per gender and one of them
always has nobody to fight. Champions are never on the relegation list — holding a
belt is the one thing that keeps you up. Nothing is written until you confirm:
flagging is a booking decision, so the proposal is shown first and then written
as ordinary `status.change` events.

**Last Stand.** `proposeLastStand` pairs the flagged names off — relegation
faces relegation, promotion faces promotion, never across genders — and hands
back the card in the entry shorthand for you to paste, play, and fill in the
winners. Someone with no opponent is reported, not quietly dropped.

Playing it moves people. On a show tagged `lastStand`, a match between two
wrestlers carrying the same flag needs no modifier at all — the flags are the
stipulation. The loser of a relegation match goes down; the winner of a
promotion match goes up; everyone who fought walks out unflagged. As with title
changes, the *destination* is worked out at write time and stored on the event,
so the effects stay pure and survive corrections.

    node tools/universe.mjs season
    node tools/universe.mjs flags --commit
    node tools/universe.mjs laststand > card.txt

## The annual draft

The year ends **WrestleMania → Last Stand → Draft**. Last Stand settles who moves
*between* tiers; the draft reshuffles everyone *within* one, so the brands on
each rung re-pick their rosters from the pool already on that rung. Free agents
join the top tier's pool.

Order is reverse season standings — worst year picks first — and it snakes, so
the first brand does not take every round's best available. Two defaults, both
overridable:

- **protectChampions** — a champion stays on the brand that owns their belt.
  Splitting a belt from its holder makes a mess of the title's brand and nobody
  books it on purpose.
- **keepTeams** — picking somebody in an active tag team brings their partners
  with them. Drafting half a tag team is almost always a mistake, not a choice.

Everything is a proposal until you press the button, and committing writes
ordinary `brand.transfer` events (or `contract.signed` for someone picked out of
free agency, who has no brand to transfer *from*). So a draft can be voided pick
by pick like any other history. Only wrestlers who actually change brand are
written.

A draft is deliberately **not** idempotent the way a roster paste is — it
reallocates a whole tier, so running it again is a different, equally valid
shuffle.

    node tools/universe.mjs draft --tier 1
    node tools/universe.mjs draft --tier 1 --commit

## Prompt export

Five prompts, each with the current state already embedded so you never
re-explain your universe to another AI:

| Prompt | Carries |
| --- | --- |
| `card-format` | the card shorthand, every brand, belt and wrestler name |
| `roster-format` | the roster shorthand, same name list |
| `recap` | one show's full card in order, what changed, who holds what |
| `contenders` | champions, season standings, rivalry heat, title shots owed |
| `next` | the open threads queue, grouped by kind, oldest first |

The two **format** prompts have a **Copy AI prompt** button sitting next to the
paste box they belong to, since that is where you want them. They tell the model
exactly what to produce — the syntax, the real names, and "never invent a
wrestler who is not on the list" — so whatever comes back pastes straight in and
parses. They work three ways: attach a screenshot and it transcribes, describe
the show and it writes it out, or ask it to book a card and it invents one using
only your roster.

Plain text, not markdown or JSON — both survive a copy worse than lines do. Each
is a pure function of a projection, so a prompt generated with the header date
set to last month describes the universe as it was then. The dashboard's Prompts
tab copies to the clipboard; the CLI writes to stdout so it can be piped.

    node tools/universe.mjs prompt contenders --brand Raw --ple "SummerSlam"
    node tools/universe.mjs prompt recap --show sh_0080 | pbcopy

## Screenshots in

Drop a screenshot of a card or a roster page on the Import tab. Two routes, both
ending in the same place — the ordinary card or roster box, with the ordinary
preview and the ordinary save button. **A screenshot is never trusted straight
into the log.**

**Bridge (default, no key, works offline).** The page builds a transcription
prompt with your roster names and championship names embedded — the single
biggest source of "unknown name" errors otherwise — and asks for the answer in
the card shorthand. Copy it, paste it into whatever AI you already use along
with the screenshot, paste the reply back. Code fences and "Here's the card:"
preambles are stripped, and the reply is routed to the card box or the roster
box by what it looks like.

**Direct (opt-in).** With an Anthropic API key the page sends the image itself
and fills the box for you, so dropping a screenshot is the whole interaction.
The key is stored in this browser's `localStorage` under `arc_universe_key_v1`
and is sent from the page to `api.anthropic.com` with the
`anthropic-dangerous-direct-browser-access` header — which means anyone with
access to the browser profile can read it. That is why it is opt-in and off by
default.

*Verification note:* the request shape, the error paths and the round trip into
the preview are all covered by checks with `fetch` stubbed — but the live call
has never been made, because there was no key to test with. If the first real
screenshot comes back with an API error, that is the place to look.

**Not attempted: local OCR.** A bundled engine would be megabytes of WASM
against this repo's no-runtime-dependencies rule, and stylised game UI is
exactly what generic OCR is worst at. Getting it quietly wrong would be worse
than asking.

## CLI

```
init | seed | roster | brands | pyramid | brand | card | show | shows | state
titles | wrestler | threads | resolve | heat | season | flags | laststand | draft | prompt
log | event | amend | void | restore | corrections | check | export
```

`--file PATH` (or `UNIVERSE_FILE`) chooses the save file; default
`data/universe.json`, which is gitignored as user data.

```
npm run check:universe     # 108 checks, no browser, no network
```
