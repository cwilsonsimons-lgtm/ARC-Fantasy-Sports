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
  laststand.js the Last Stand board — candidates, legal pairings, recording
  championships.js  belts per brand — add, move, retire, delete, call-ups
  calendar.js  the 28-day cycle, the weekly nights, one card read back
  ples.js      the PLE schedule — placing, moving, brand assignments
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
  universe-check.mjs     510 data-layer checks, pure Node
  universe-ui-check.mjs  260 browser checks against the built page
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
| `brand` | `b:raw` | name, abbr, color, logo, tier, slot (1–7), day, parentId |
| `championship` | `c:wwe-championship` | name, brandId, division, teamSize, activeFrom, retiredOn, autoPromote |
| `group` | `g:the-bloodline` | name, kind (`tagTeam` / `faction` / `alliance`), memberIds, leaderId, brandId |
| `ple` | `p:survivor-series` | name, day (1–28), **brandIds**, logo, color, description, type, special |

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
| `alliance.formed` | member, leader | groupId, groupKind, name, join | `group.form`, `group.join` |
| `alliance.broken` | member | groupId, dissolve, betrayal | `group.leave`, `group.dissolve`, `thread.open` |
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

`alliance.formed` with `data.join` is somebody walking into a group that already
exists: one name is enough, and it writes `group.join` **without** `group.form`,
so joining does not restate the group's founding or revive one that had split
up. Without the flag it is a group coming into existence, which needs two.

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
    node tools/universe.mjs belts                    # how many each show carries
    node tools/universe.mjs belt "NXT North American Championship" --brand NXT
    node tools/universe.mjs belt "Hardcore Championship" --retire

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

### How many belts a show carries

Up to you, per show. The Titles tab groups every belt under the brand that
carries it, each row saying how many it has and how many of them call their
champion up, with **+ add** to give that show another. A brand with none says so
rather than being left out — "none" is a legitimate answer, and one you may be
about to change.

| Doing | What it writes |
| --- | --- |
| adding a belt | a new `championship` entity — vacant, no history |
| renaming, moving show, changing division | an entity correction |
| retiring | `retiredOn` — off the active list, lineage kept |
| deleting | removes the entity, and only when nothing in the log mentions it |

**Retiring and deleting are different things and the UI offers whichever fits.**
A belt that has ever been contested keeps its lineage, because that lineage is
somebody's career; deleting is offered only for a belt the log has never
touched, which is the one you created by mistake five seconds ago. The store
enforces the floor: `removeEntity` refuses anything an event points at, whatever
kind it is.

Belts sort world titles first, then by division, so a show's row reads the way a
title screen does rather than in creation order.

**`autoPromote`** marks a belt whose holder is called up a tier without having
to win a Last Stand match — see [Automatic promotion](#automatic-promotion). It
is a field on the belt precisely so that no rule in the code has to name NXT.
A new belt on a show whose other belts already call people up **inherits that by
default**, so adding a second NXT title does not quietly opt it out of the rule
the first one follows. The form says where that show's champions would land
before you save it, and refuses the flag on a top-tier belt, which has nowhere
to call anybody up to.

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

**A paste is one brand's roster, not a list of additions to it.** Rosters are
read off the game one brand at a time, so a Raw paste says *this is Raw*:
anybody on Raw who is not in it has left, and comes off the brand into free
agency. Where they actually went is deliberately not guessed — one brand's list
cannot tell a release from a jump to SmackDown — so they wait as free agents
until the paste that claims them. Paste the other brands next and everyone lands
where they belong.

Only the brands the paste **names** are claimed. Saying nothing about NXT is not
the same as saying NXT is empty, so a Raw paste leaves every other brand exactly
as it was. The report and the preview both say which brands were read as
complete, and name everybody coming off before anything is written.

For a deliberately partial paste — half a division, one call-up typed by hand —
tick **only add and update** beside the box (`--add-only` on the CLI) and
nobody is taken off.

Gender and alignment are registry facts, so they are written as entity
corrections rather than events.

**Groups are synced the same way**, and the three cases are kept apart:

| The paste says | What is written |
| --- | --- |
| a group that does not exist | `alliance.formed` — the group forms |
| a group that exists, with a new name in it | `alliance.formed` with `join`, for that person alone |
| a group that exists, minus somebody | `alliance.broken` for the leaver |

That middle row is why `alliance.formed` carries a `join` flag: forming a group
needs two people, but *joining* one is a single name, and the event that says
"Bron Breakker is in The Judgment Day now" must not also restate when the group
formed or revive one that had split up. A wholesale line-up change — everyone
out, new people in — is a re-form rather than a fold, so the group stays alive
with the members you pasted.

A departure written by an import is never a **betrayal**: a paste states who is
in a group, it does not tell a story about somebody turning. Type it on a card
when you want the thread.

```
node tools/universe.mjs roster raw.txt --dry        # preview: who joins, who comes off
node tools/universe.mjs roster raw.txt              # one brand at a time
node tools/universe.mjs roster callup.txt --add-only
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
npm run check:universe-ui    # 260 browser checks
```

| Tab | What it does |
| --- | --- |
| Tonight | Type a card. The right-hand pane shows what the parser heard, updated on every keystroke; the save button stays disabled while anything is wrong. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves. Below it: active rivalries, active alliances and the oldest open threads. |
| Roster | Paste box (collapsed) over a table per brand, plus free agents and every team and faction. |
| Pyramid | The tier diagram, and the form that creates or edits a show. |
| Titles | Every belt with holder, interim holder, days, defenses and reign count. Belts flagged `autoPromote` say so. Click one for its own page: full lineage with day counts, interim runs marked, and every match it has been on the line for. |
| Threads | Open questions, oldest first, with how long each has been sitting. Resolve one and it appends an event. Recently closed threads underneath, with what closed them. |
| Season | The calendar with the current phase lit, standings per brand, the promotion and relegation lists, the Last Stand competitions, the draft board, and every season on record. |
| Calendar | The 28-day cycle: four weeks of seven days, weekly shows on their night, PLEs where you put them (drag one to move it), every card on its day, and the cycles on record to jump back through. Filter the whole grid by brand. |
| Last Stand | The offseason board: the pyramid with candidate counts, rosters by tier, automatic call-ups, promotion and relegation candidates in separate tables, a match maker that cannot make an illegal match, what is still to settle, results, and the roster movements they caused. |
| Shows | Every saved card, newest first — an index; click one to read the night. |
| Log | Every event and every correction. Open a match to fix a wrong result; void or restore anything. |
| Prompts | Five copy-paste prompts with the current state embedded. |
| Import | Drop screenshots of a card or a roster and turn them into events. |

Clicking any wrestler's name opens their profile: record, win rate, streak,
title reigns with day counts, rivalries and alliances sorted by heat, open
threads they are part of, every brand their career has passed through and why,
and a timeline of every event they appear in.

The whole page is a function of the projection: an action appends to the log,
then everything redraws. That is why fixing a result in the Log tab moves the
records on the Roster tab and the holder on the Titles tab with no further
work — there is no second copy of the truth to update.

**State as of** in the header re-projects the entire page at a past date, using
the same `project(store, {asOf})` the CLI uses.

Storage is `localStorage` under `arc_universe_v1`, seeded from `seed-data.js` on
first load. The fantasy app's keys are never read or written. If a write fails
(quota, private mode) the page says so rather than pretending it saved.

## The calendar

**The universe runs on a repeating 28-day cycle.** Four weeks of seven days,
days 1 to 28, and no real-world months:

    Week 1   days 1–7
    Week 2   days 8–14
    Week 3   days 15–21
    Week 4   days 22–28

Two different kinds of thing sit on that grid, and the difference is the point:

- **Weekly shows repeat.** A brand runs on a *slot* inside the week (1–7), so a
  show on slot 2 appears on days 2, 9, 16 and 23 of every cycle. Set it on the
  Pyramid tab.
- **PLEs are placed.** One day, chosen by you, moved whenever you like. Nothing
  in the code has an opinion about which day anything lands on.

Underneath, events still carry real ISO dates — reign day counts, rivalry decay
and "state as of" all need a real timeline, and a second clock would be one more
thing to keep in step. So the cycle is a **lens**: an anchor date is day 1 of
cycle 1, and `cycleOf(state, date)` maps any date to `(cycle, day, week)`. Cards
you have already played land on the day they fall on. The anchor lives in
`doc.calendar.start` and defaults to the first thing that ever happened.

    node tools/universe.mjs calendar              # this cycle
    node tools/universe.mjs calendar --cycle 3
    node tools/universe.mjs show sh_0088          # one card, and what it changed

### PLEs

A PLE is an **entity**, not an event: "SummerSlam happens on day 21" is a fact
about your universe the way a brand or a belt is, while "SummerSlam 2027 was
held and Cody beat Roman" is what happened and stays in the log. Moving a PLE
therefore rewrites no history — the shows you have already played keep their
dates and their cards.

| Field | |
| --- | --- |
| `name` `logo` `color` `description` | what it is |
| `day` | 1–28. Move it whenever; nothing is fixed |
| `brandIds` | **a list** — one brand, several, or all of them |
| `type` | `ple`, or `special` for one the universe's own rules hang off |
| `special` | `wrestlemania` / `lastStand` / `draft` — the rule it carries |

**Brands are a list, never a single id.** Survivor Series being Raw *and*
SmackDown is the ordinary case, so `brandIds` is an array and a PLE appears
under every brand it includes when the calendar is filtered — either of Raw or
SmackDown finds it, Dynamite does not. The picker is built from whatever brands
the universe has, so a show you invent today can host a PLE tonight.

On the grid a PLE is deliberately louder than a weekly show: its name, then its
brands underneath in capitals. Several on one day stack rather than break the
layout.

**Moving one.** Drag it onto any day, or open it and change the day. Either way
only the day changes — the brands, the rule it carries, everything else stays.

    node tools/universe.mjs ples
    node tools/universe.mjs ple "Survivor Series" --day 21 --brands "Raw, SmackDown"
    node tools/universe.mjs ple "Survivor Series" --day 14      # just moves it
    node tools/universe.mjs ple "Bound for Glory" --day 24 --brands all --special lastStand

### Special events

Last Stand is a PLE like any other with a rule attached, rather than a separate
event system. It has a day, brands, and can be moved; `special: 'lastStand'` is
what the offseason machinery reads. That means the rule is **not tied to a
name** — call yours Bound for Glory and a card headed `Bound for Glory` is
recognised as your Last Stand, because `card.js` checks your schedule before it
checks the built-in list of famous names.

One event carries each rule, which is why a second `lastStand` is refused: the
season machinery would have no way to say which was meant.

**Order is knowledge; placement is yours.** The offseason runs WrestleMania →
Last Stand → Draft and the app knows it, so if all three are placed and the days
contradict that, the calendar says so — as a note, because a schedule that runs
across two cycles is perfectly legitimate and only you know. Nothing is ever
moved for you and no day is ever chosen for you.

A new universe opens on a **clean cycle**: 28 empty days, no real-world PLE
dates assumed. Weekly shows come from the brands; everything else you place.

## The year

    regular season ...  WrestleMania  →  Last Stand  →  Draft  →  new season

WrestleMania ends the wrestling season and opens the offseason. Last Stand
settles who moves between tiers. The Draft reshuffles what is left, and **the
season closes when the Draft does**, so the next year opens with the rosters the
draft produced.

Each PLE is recognised from the show's name, so `WrestleMania 43 / 2027-04-04 /
Raw` needs no extra marker (`PLE: lastStand` in the header forces it).

The app always knows which phase it is in, and so does every past year:

| Phase | Means |
| --- | --- |
| `regular` | before WrestleMania — book the season |
| `wrestlemania` | WrestleMania has happened; the lists are due |
| `lastStand` | the lists are up; Last Stand settles them |
| `draft` | Last Stand is done; the draft is next |
| `newSeason` | the draft closed the year; nothing booked yet |
| `complete` | a finished season, kept on record |

Phases are **derived**, not stored: `seasons(state)` walks the PLE markers in the
log and hands back every year with its WrestleMania, Last Stand and Draft dates
and the phase it reached. Historical seasons read back the same way the current
one does, and voiding the draft merges the two years either side of it back into
one. A save that never runs a draft is not stuck in an endless year either — a
Last Stand followed by another WrestleMania closes the season too.

The Season tab draws the calendar with the current phase lit and says what to do
next; the CLI prints the same line.

**Standings** are win totals inside the season window — 3 points a win, 1 a
draw — ordered by points, then win rate, then matches wrestled. That last
tiebreak matters: among a group all sitting on zero, the one who was barely
booked sinks to the bottom rather than whoever comes last alphabetically.

**The lists.** After WrestleMania, `proposeFlags` reads the pyramid: every brand
with a rung beneath it puts its bottom names on the relegation list, every brand
with a rung above it puts its top names on the promotion list, **per brand and
per gender**, because that is the shape of the competition. On a three-tier
pyramid the middle rung does both — NXT names go up to tier 1 and down to Evolve
in the same year.

A group with only one eligible name is **skipped and reported**, not flagged:
one name alone has nobody to face, and flagging them would leave a marker that
nothing could ever clear. Champions are never on the relegation list — holding a
belt is the one thing that keeps you up. Nothing is written until you confirm:
flagging is a booking decision, so the proposal is shown first and then written
as ordinary `status.change` events.

## Last Stand

**Promotion and relegation are separate competitions, and each is settled inside
a single show.** The unit is a *group*: one brand, one gender, one direction.

- A Raw name fighting relegation faces another **Raw** name, because what is at
  stake is the Raw spot. They never face a SmackDown name, and never a promotion
  candidate.
- Two Evolve names up for promotion face each other; the winner goes up to NXT,
  the loser stays.
- Nothing here names a brand or a tier — the groups come out of the pyramid, so
  the same code settles Raw↔NXT and Evolve↔Deep South.

**Brackets.** A group has `spots` (default 1) and as many candidates as you set
(`candidatesPerBrand`, default 2). Two candidates and one spot is one match. Four
candidates and one spot is a bracket: two qualifiers, then a final between the
two who are still in it — for relegation that means the two *losers* meet, and
the loser of that goes down. An odd group gives somebody a bye into the next
round rather than matching them outside their own competition.

A qualifier **moves nobody** — a semi-final must not relegate anyone. It does
clear the flag of whoever is out of the running (the winner of a relegation
qualifier is safe), so nobody carries a marker into next year that nothing can
remove. Only the deciding round carries `stakes`, and the generated card spells
that out per line: `— relegation to NXT` versus `— relegation qualifier`.

`proposeLastStand` is re-runnable: it reads the rounds already wrestled this
year, works out who is still standing, and hands back the *next* round. Book it,
enter the results, press it again.

Playing it moves people. On a show tagged `lastStand`, a match between two
wrestlers carrying the same flag needs no modifier at all — the flags are the
stipulation. The loser of a relegation match goes down; the winner of a
promotion match goes up; everyone who fought walks out unflagged. As with title
changes, the *destination* is worked out at write time and stored on the event,
so the effects stay pure and survive corrections.

    node tools/universe.mjs season          # phase, calendar, seasons on record
    node tools/universe.mjs flags --commit
    node tools/universe.mjs laststand --board   # the whole board, as the tab draws it
    node tools/universe.mjs laststand > card.txt
    node tools/universe.mjs draft --tier 1 --commit

### The Last Stand tab

Its own tab, because the offseason is the one week where everything is happening
at once. Top to bottom: the pyramid with a candidate count on every brand, the
rosters by tier, the automatic call-ups, **promotion candidates and relegation
candidates in two separate tables**, the match maker, what is still to settle,
the results so far, and every roster movement they have produced.

The two lists never share a table. They are separate competitions, and reading
them as one list is exactly how an illegal pairing gets booked.

**The match maker cannot make an illegal match.** Pick the first name and the
second picker is rebuilt from `eligibleOpponents` — which is the rule itself:

| Picking | Offers |
| --- | --- |
| a relegation candidate | other candidates **on the same brand**, same gender |
| a promotion candidate | other candidates chasing **the same spot**, same gender |

So Raw vs SmackDown, Raw vs NXT, NXT vs Evolve and candidate vs non-candidate
are not refused — they are never offered. `checkPairing` states the same rule as
a guard for anything that arrives another way (a CLI card, a pasted line), and
its errors say *why*: "relegation is settled inside one show — Seth Rollins is on
Raw and Tommaso Ciampa is on SmackDown". An intergender pairing is the one thing
that warns rather than blocks: strange booking, not broken booking.

Entering the winner does the rest. `recordMatch` works out whether this match
decides the group or is a qualifier, writes it onto this year's Last Stand show
(opening one if there isn't one), and the roster movement follows as an ordinary
effect. Which means it is in the wrestler's history like any other transfer, and
**voiding the match hands them back** — there is no separate "movements" store to
keep in step.

Every profile page carries a **Roster movements** table: every brand that career
has passed through, with the date, where they came from, and why — signed,
drafted, promoted, relegated, released. `movementsFor(state, ref)` reads it off
the `roster.brand` effects rather than the events, because a Last Stand movement
is a consequence of a *match*, not a transfer event of its own.

### Automatic promotion

A championship can carry `autoPromote: true`. Its holder goes into the draft pool
one tier up **without wrestling a Last Stand match** — the belt already settled
it. They are left off the promotion list (nothing to fight for), and the draft
pools them with the tier they are joining.

It is a field on the championship, not a rule in the code: the shipped seed sets
it on the NXT Championship and NXT Women's Championship and nothing else, so
Evolve's champions still have to earn it. Clear the flag and the call-up stops;
set it on some other belt in some other pyramid and that belt calls people up
instead. A belt on the top tier never triggers one, because there is nowhere
above it to go.

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
npm run check:universe     # 510 checks, no browser, no network
```
