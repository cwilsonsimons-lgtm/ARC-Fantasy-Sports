# Deep Dive — Fantasy App Subsystems

**Generated:** 2026-08-07 · **Level:** mid · **Mode:** compact
**Source:** `arc-fantasy_2026-08-04_0716.html` (single-file bundle)

Five subsystems built across items 11–34. Function-level map plus the design
reasoning behind each. Skips language basics; focuses on why each shape was
chosen and what the alternatives were.

---

## 0. The constraint that shaped everything

Every decision below is downstream of one fact: **this app is a single
self-contained HTML file with no backend and no framework.** State lives in one
`localStorage` object (`store`). Rendering is string templates assigned to
`innerHTML`, driven by inline `onclick` handlers that resolve against `window`.

Three consequences recur:

1. **No reactivity.** Nothing re-renders itself. If data changes, some function
   must explicitly repaint each surface showing it. This is why subsystem 5
   exists at all.
2. **Derived-on-read, not stored.** With no migration system worth the name,
   computing values from raw data at render time is safer than persisting
   computed values that can drift. Records, brackets and capacity all follow this.
3. **`Object.assign(window, exports)` snapshots.** The bundle's export bridge
   copies exported *variables* once at boot. `window.setTab` is frozen at its
   initial value forever; exported *functions* work fine because the binding
   they close over is live. This bit two of my own tests.

---

## 1. Records & League Median

**Files/region:** bundle lines ~13198–13260

### Key components

| Function | One-line purpose |
|---|---|
| `leagueMedianOn()` | Whether the league counts a second result per week |
| `weekPointsOf(key, week)` | One team's points that week, live value for the user's own team |
| `weekMedian(week)` | The middle score across the league that week |
| `weekResult(key, week)` | `{opp, pts, oppPts, med, h2h, median}` — or `null` if unplayed |
| `teamRecord(key)` | Walks played weeks, accumulates `{w,l,t}` |
| `recordText(key)` | `"3-1"` or `"3-1-1"` |
| `resultBadges(key, week)` | The `H2H W` / `MED L` chips on a matchup |

### What it does

Before this, `T[key].rec` was the literal string `"0-0"` baked into the team
table. Standings displayed it directly, so nothing that happened in the league
ever reached them. `teamRecord()` now derives the record by walking each played
week, asking `weekResult()` what happened, and tallying.

League Median rides on the same walk: when enabled, each played week
contributes **two** results instead of one — the head-to-head, plus a win or
loss against that week's median score.

### Why this shape

**Derived, not stored.** A `wins` counter on each team would be one number to
maintain in every place a score can change — and after this session that
includes commissioner score overrides, schedule edits and the live lineup.
Deriving means a corrected score in week 3 fixes the standings for free. The
cost is recomputation on every render; with 10 teams × 14 weeks that's trivial.

**`null` for unplayed weeks, not zero.** `weekResult()` returns `null` above
`LIVE_WEEK`. A zero would be indistinguishable from a real 0-0 tie and would
silently add a result to every team's record for weeks nobody has played.
Making "no data" a distinct value from "a value of zero" is the whole point.

**Median as a second result, not a separate table.** The alternative — a parallel
`medianRecord` — would double every display site and force callers to know which
one to read. Folding it into the same `{w,l,t}` means standings, matchup heroes,
the team screen and the schedule page all read `recordText()` and are correct
under either setting.

**Even/odd handling.** `weekMedian` averages the two middle scores when the
league has an even number of teams. With 10 teams that guarantees exactly 5
above and 5 below — verified in testing. Using a *middle element* instead would
bias the split whenever the count is even.

### Trade-off worth knowing

Ties on the median count as a tie. Some leagues award a win instead. That's a
one-line change in `weekResult`, but it's a real rules decision, not a default.

---

## 2. Roster capacity

**Files/region:** bundle lines ~7918–7950, enforcement at call sites

### Key components

| Function | One-line purpose |
|---|---|
| `benchSpace(key)` | Count of empty bench slots |
| `rosterCap(key)` | Total configured seats: starters + bench + taxi + IR |
| `rosterCount(key)` | Players currently held across all four rows |
| `rosterFull(key)` | True when there is no bench slot to land in |
| `rosterFullMsg(key)` | The error text, naming the bench as the blocker |
| `seatPlayer(key, p)` | Seats a player, **returns false** if there is no room |

### What it does

The bug was two lines, in two places:

```js
if (i > -1) bench[i] = p;
else bench.push(p);        // ← grows the roster past its configured size
```

`seatPlayer()` now returns `false` instead of pushing, and five call sites —
free agency, commissioner assignment, commissioner swaps, trades, draft edits —
check before committing.

### Why this shape

**A predicate that returns a boolean, not one that throws.** Callers differ in
what "no room" means: free agency aborts, a trade must *roll back both rosters*,
a commissioner swap must put everything back where it came from. A return value
lets each caller handle its own unwind; an exception would force try/catch
around five unrelated flows.

**Capacity is a question about the bench, not the roster.** This is the
non-obvious part. `rosterCap` counts all four rows (19 by default) but every add
path lands on the bench (7 slots). A team can sit at 15/19 and still have
nowhere to put a player. The first version of the error message said
"15/19" — technically true, actively misleading. It now leads with
`7/7 bench`.

**Draft edits measure something different again.** `fillRoster()` seats drafted
players into starters *then* bench, so the ceiling for drafted players is
`starters.length + bench.length` (15), not the full cap. My first guard compared
against 19 and never fired. Same concept, three different denominators depending
on which door the player comes through — worth internalising if you extend this.

**Trades check after the outgoing players leave.** `applyTrade` clears the
outgoing seats first, then counts space, then seats the incoming players. Doing
it in the other order would reject a legal even swap on a full roster.

---

## 3. Archive & delete lifecycle

**Files/region:** bundle lines ~14087–14200, `purgedLeagues()` at ~7110

### Key components

| Function | One-line purpose |
|---|---|
| `leagueFlag(id)` | Per-league flag bag, created on demand |
| `isArchived` / `isPendingDelete` / `deleteDaysLeft` | State predicates |
| `liveLeagueCount()` | How many leagues are neither archived nor doomed |
| `archiveLeague` / `restoreLeague` | Reversible hide/unhide |
| `scheduleDelete(id)` | Opens the 30-day window |
| `purgeLeague(id)` | Removes every bag the league owns |
| `deleteNow` / `sweepDeletions` | Immediate purge / expiry sweep at boot |

### What it does

Three states — active, archived, scheduled-for-deletion — held as flags rather
than by moving league records around. Deletion takes four gates (warning, exact
name typed, acknowledgement, 3-second hold) and *still* doesn't delete: it opens
a recovery window.

### Why this shape

**Flags beside the data, not a moved record.** Archiving by splicing the league
out of one array into another means restore has to reconstruct ordering and
every lookup has to search two places. A flag keeps one source of truth; the
views filter.

**A named list of owned bags.** `LEAGUE_BAGS` enumerates the fourteen
`store` keys a league owns. The alternative — walking `store` and deleting
anything containing the id — would be shorter and would eventually delete
something it shouldn't. Explicit beats clever when the operation is
irreversible.

**Deletion is a scheduled state, not an action.** This is the interesting
inversion: the destructive button doesn't destroy. It sets `deleteAt` 30 days
out, and `sweepDeletions()` at boot does the actual work. Recovery is then just
`delete flag.deleteAt` — no undo stack, no trash table, no restoring from a
backup copy.

**Escalating friction, each gate testing something different.** Typing the exact
name proves you know *which* league; the checkbox proves you read the
consequence; the hold defeats muscle memory. Four identical "are you sure?"
dialogs would be four times the friction and none of the assurance.

**The press-and-hold cancels on `pointerleave`, not just `pointerup`.** Dragging
off the button mid-hold is a deliberate abort and reads as one to the user.

**Seeded leagues need a tombstone.** The four demo leagues live in a
compile-time `LEAGUES` constant — removing one from `store.myLeagues` can't
touch it. `purgedLeagues()` records the id and `allLeagues()` filters it. Any
"delete" over data you don't own needs somewhere to record the absence.

**Guard rail:** `liveLeagueCount() <= 1` refuses both archive and delete. An app
whose home screen can reach zero leagues has a state with no way out.

---

## 4. Playoff bracket

**Files/region:** bundle lines ~10952–11060

### Key components

| Function | One-line purpose |
|---|---|
| `playoffSeeds()` | Saved seed order, with standings filling any gaps |
| `setSeedTeam(i, key)` | Swaps two seeds |
| `bracketSize(n)` | Next power of two at or above `n` |
| `playoffByes()` | `bracketSize(n) - n`, awarded to the top seeds |
| `playoffPairs()` | Round-one pairings as seed numbers |
| `setPlayoffPair(idx, side, seed)` | Swaps a seed between round-one slots |
| `bracketRounds()` | Walks the bracket forward, round by round |
| `roundName(r, total)` | Names a round from the end: Championship, Semifinal… |

### Why this shape

**Seeds are numbers; teams resolve at render.** `playoffPairs()` returns
`[[3,6],[4,5]]` — seed numbers, never team keys. Reordering the seeds
automatically reshapes every pairing, because the pairing layer doesn't know
what a team is. Storing team keys would desync the moment a seed changed.

**Saved order is a prefix, not a replacement.** `playoffSeeds()` concatenates
the commissioner's saved list with standings order filtered for anything not
already in it. A commissioner who pins only the top two seeds gets those two
honoured and the rest tracking the standings — no need to pin all ten, and a
new team can't fall off the list.

**Byes are derived, never stored.** `bracketSize(6) - 6 = 2`. Changing the team
count reshapes byes, round-one pairings, round count and round names in one
step, because all four descend from `n`. A stored bye count is a second source
of truth that will disagree eventually.

**Round names count backwards from the final.** `roundName(r, total)` names by
distance from the end, so a 4-team bracket calls round 1 "Semifinal" and an
8-team bracket calls it "Quarterfinal" — correct without a lookup table per
size.

**Saved pairings are validated by set-equality.** `playoffPairs()` keeps a saved
override only if it covers exactly the same seed numbers the current bracket
generates; otherwise it discards it. Shrinking from 8 teams to 4 would otherwise
resurrect pairings referencing seeds 5–8.

**Latent issue this surfaced:** the default `playoffStart` (15) sits outside a
14-week season, so the `<select>` couldn't represent it and fell back to its
first option while the summary still read "weeks 15–14". Now clamped so the
rounds always fit. Defaults that fall outside their own control's range fail
quietly — worth checking wherever a stored value feeds a bounded input.

---

## 5. Photo propagation & league scoping

**Files/region:** bundle lines ~11808–11880, ~12847–12870, ~13506

### Key components

| Function | One-line purpose |
|---|---|
| `leaguePlayers(id)` | The per-league player-override bag |
| `playerPhoto(name)` / `playerRec(name)` | Read one override |
| `faceInner(key)` | Custom photo, else NFL headshot, else initials |
| `removePlayerPhoto(key)` | Drops the photo, keeps a nickname |
| `refreshPlayerArt()` | Repaints every surface that can draw a face |
| `migratePlayerLeagues2()` | Lifts a flat legacy bag under its league id |

### Why this shape

**Two-level key: league → player.** `store.players[leagueId][playerId]`. The
nesting *is* the isolation — a read can't reach another league's override
because it never has that object. An `ownerLeague` field on a flat record would
put the isolation in every call site instead, and one missed check leaks a photo
across leagues.

**Explicit repaint, guarded per surface.** With no reactivity, "update
everywhere" means naming every renderer. `refreshPlayerArt()` checks whether
each view is actually mounted before repainting, and wraps each in a try/catch
so one failing surface doesn't abort the rest. Blunt, but honest about the
architecture — the framework alternative is a framework.

**Fallback chain in one place.** `faceInner()` owns custom → headshot →
initials. Callers ask for a face and get the best available. Removing a photo
needs no cleanup because the chain simply falls through.

**Migration guesses conservatively.** `migratePlayerLeagues2()` detects whether
the existing bag is flat or already nested by checking for `photo`/`nick` keys,
then nests under `cbd`. One-time migrations guarded by a version flag
(`pkeyv3`) are the cheapest safe pattern when there's no schema.

---

## Also built this session (one line each)

- **Draft board rows** — `POS • TEAM • Bye N` with both name and meta ellipsized so rows stay a uniform 45px and scrolling never reflows.
- **Trade block** — per-league bag, preferences prompted at the moment of listing rather than on a separate screen.
- **Crest layering** — moved out of the flex score column onto the arena so it centres on the container, not on content; strict z-order 0/1/2.
- **Draft timer** — single source (`draftCfg().pickSeconds`), clamped 5s–60m, rendered inside the Current Pick card.
- **Team schedule** — reuses `weekResult()` from subsystem 1; the running record is the same accumulator as `teamRecord()`.

---

## The one thing to take away

Four of these five subsystems replaced a **stored value** with a **derived
one**: records, byes, bracket rounds, capacity. In a codebase with no schema, no
migrations and no server, every persisted computed value is a future
inconsistency — something will change the input and miss the cache. Deriving on
read costs microseconds here and removes an entire class of bug.

The exception proves the rule: photo overrides *are* stored, because they're
user input, not a computation. Store what you can't recompute; derive
everything else.
