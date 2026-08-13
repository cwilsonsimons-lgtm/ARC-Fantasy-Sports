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
  roster.js    paste a roster, diff it, print who is on each brand
  card.js      type a show's card in shorthand
  util.js      name resolution and plain-text tables
  seed-data.js generated from data/universe-seed.json for the browser build
  ui/
    app.js     boot, tabs, actions — the only file that touches storage
    views.js   roster / titles / shows / log / sheets, projection in, HTML out
    entry.js   the card and roster boxes, with live previews
    dom.js     escaping, tables, delegated events
universe.html  the dashboard page
tools/
  universe.mjs           the CLI
  universe-check.mjs     108 data-layer checks, pure Node
  universe-ui-check.mjs  54 browser checks against the built page
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
| `brand` | `b:raw` | name, color, tier |
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
| `show` | — | name, brandId | `show.open` |
| `match` | competitor / winner / loser | matchType, decision, titleId, titleChanged | `record.*`, `title.award` or `title.defense`, `feud.heat` |
| `attack` | attacker, victim | context | `feud.heat` |
| `promo` | speaker, target | topic | `feud.heat` |
| `alliance.formed` | member, leader | groupId, groupKind, name | `group.form`, `group.join` |
| `alliance.broken` | member | groupId, dissolve | `group.leave`, `group.dissolve` |
| `title.change` | champion | titleId, reason (`won`/`awarded`/`vacated`/`stripped`/`retired`) | `title.award` or `title.vacate` |
| `injury` | subject | severity, weeks, expectedReturn | `injury.start`, `roster.status` |
| `injury.cleared` | subject | status | `injury.end`, `roster.status` |
| `contract.signed` | subject | brandId, expires, terms | `contract.start`, `roster.brand`, `roster.status` |
| `contract.expired` | subject | reason, released | `contract.end`, `roster.brand`, `roster.status` |
| `brand.transfer` | subject | toBrandId, reason, status | `roster.brand` |
| `status.change` | subject | status, reason | `roster.status` |

The four beyond the original brief — `show`, `injury.cleared`, `status.change`
and the vacate path on `title.change` — exist because the log would otherwise
have no way to end an injury, clear a promotion flag, group a card, or empty a
belt.

A title won in a match is **not** also written as a separate `title.change`. The
match already carries the `title.award` effect, so correcting the winner moves
the reign with it; a second linked event would survive that correction and leave
the belt on the wrong wrestler. `title.change` is for changes outside a match.

`brand.transfer` does not touch the roster flag unless `data.status` says so. A
promotion that auto-cleared the promotion flag would fight a re-pasted roster
that still reads `promotion`, and the import would never settle.

### Effects

`record.win` `record.loss` `record.draw` · `title.award` `title.vacate`
`title.defense` · `roster.brand` `roster.status` `roster.align` ·
`contract.start` `contract.end` · `injury.start` `injury.end` · `group.form`
`group.join` `group.leave` `group.dissolve` · `feud.heat` · `show.open`

`project.js` has one handler per kind, so adding an event type usually means
reusing these rather than growing the list.

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
npm run check:universe-ui    # 54 browser checks
```

| Tab | What it does |
| --- | --- |
| Tonight | Type a card. The right-hand pane shows what the parser heard, updated on every keystroke; the save button stays disabled while anything is wrong. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves. |
| Roster | Paste box (collapsed) over a table per brand, plus free agents and every team and faction. |
| Titles | Every belt with holder, days, defenses and reign count. Click one for its lineage. |
| Shows | Every saved card, newest first. |
| Log | Every event and every correction. Open a match to fix a wrong result; void or restore anything. |

The whole page is a function of the projection: an action appends to the log,
then everything redraws. That is why fixing a result in the Log tab moves the
records on the Roster tab and the holder on the Titles tab with no further
work — there is no second copy of the truth to update.

**State as of** in the header re-projects the entire page at a past date, using
the same `project(store, {asOf})` the CLI uses.

Storage is `localStorage` under `arc_universe_v1`, seeded from `seed-data.js` on
first load. The fantasy app's keys are never read or written. If a write fails
(quota, private mode) the page says so rather than pretending it saved.

## CLI

```
init | seed | roster | brands | card | show | shows | state | titles | wrestler
log | event | amend | void | restore | corrections | check | export
```

`--file PATH` (or `UNIVERSE_FILE`) chooses the save file; default
`data/universe.json`, which is gitignored as user data.

```
npm run check:universe     # 108 checks, no browser, no network
```
