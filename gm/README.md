# Wrestling GM — prototype

The player is the kayfabe General Manager of a weekly wrestling television
show. This is the first skeleton: view the roster, book a card, run the show
segment by segment, face the network's verdict, advance the week.

Simulated so far: **who you used and who you left out**. Not yet: relationships,
incidents, factions, championships, or anything running long.

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
js/store.js the single source of truth and the only writer to localStorage
js/data/    seed data
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

## Saves

One `localStorage` key, `wgm_v1`, holding a versioned state object. `load()`
upgrades older saves in place rather than wiping them and writes the upgrade
back immediately, so a save is never left half-shaped on disk.
