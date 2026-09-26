# City Boys Dynasty

Fantasy football league app prototype — matchups, standings, rosters, a mock
draft room, free agency, and a simulated live-scoring week clock.

It also carries **Universe**, a companion for WWE 2K25's Universe Mode — see
[WWE Universe](#wwe-universe) below.

## Running it

**Just want to look at it?** Open `dist/index.html` — it is the whole app in one
self-contained file, so double-clicking it works. Rebuild it with `npm run build`
after changing anything under `css/` or `js/`.

**Working on the code?** The source is plain ES modules, which browsers refuse to
load over `file://`, so it needs to be served:

```
npm start          # serves the repo at http://127.0.0.1:8080
```

No framework and no runtime dependencies; `esbuild` is only used to produce the
single-file build, and `playwright` only for the verification harness.

### Fonts

The typefaces are embedded as base64 `@font-face` rules in `css/fonts.css`, so
the app renders identically with no network at all. It previously linked
fonts.googleapis.com, which meant the design only appeared online — offline,
every `font-family:'Oswald'` rule (78 of them, none with a fallback) dropped to
the browser's default serif and the whole app changed character. Every family
now carries a fallback too, so a miss degrades to a condensed sans rather than
Times. Regenerate with `node tools/fetch-fonts.mjs` after changing the type.

## Arc Markets

The **Markets** item in the bottom nav opens Arc Markets — a separate section, not
another fantasy screen. It takes over the whole phone with its own header, its own
blue palette, its own bottom nav and its own `localStorage` key
(`arc_markets_v1`). "Leagues" in its nav returns to the fantasy app.

The code boundary matches the product boundary: `js/markets/` imports only from
`js/data/` (plain NFL facts — players, teams, colours) and never touches league
settings, rosters, lineups or scoring. The only seam is `openMarkets()`, which
adds a class to `<body>`.

**The pricing model** comes from the concept brief: a contract settles on the
player's official season production at **100 points per dollar**, so a player
projected for 328 points prices near $3.28 and pays out their real total ÷ 100 at
season end. Prices are therefore derived from real projections rather than copied
from the mockups, which keeps the whole market internally consistent. Day moves,
trade counts and sparklines are seeded from each player's id, so the numbers are
stable across reloads and screenshots.

Deliberately *not* faked: the News and History tabs are empty states rather than
invented headlines about real players.

`npm run check:markets` drives the section through 23 interaction checks. Several
assert *geometry*, not just DOM, because both bugs found here were invisible to
content assertions: a body state class that collided with the sheet element's own
class (applying `position:absolute; transform:translateY(102%)` to `<body>` and
sliding the app off screen), and a `.face` rule scoped so narrowly that a face
used outside a card or row rendered its headshot at full natural size. The check
also fakes a successful headshot load, so layout is tested the way a user with a
working network sees it.

## WWE Universe

The **Universe** item in the bottom nav opens a companion for WWE 2K25's
Universe Mode. The matches are played or watched in the game, with the CPU
deciding who wins; the owner records the results here afterwards. It never
simulates a match, picks a winner, books a card or talks to the game. And the
owner is exactly that — someone who sees every wrestler, relationship and
result — not a GM character inside the universe, so there is no in-world
viewpoint or hidden information anywhere in the model.

It follows the Markets pattern: a separate section with its own palette
(championship gold), its own `localStorage` key (`wwe_universe_v1`), and one
seam with the fantasy app — `openUniverse()` / `closeUniverse()` toggle a class
on `<body>`. The fantasy league still opens by default; nothing it stores is
read or written.

### The data

`js/universe/model.js` is pure — no DOM, no storage, no clock, no randomness —
so the whole model runs under Node for tests exactly as it does in the page.

| Record    | Holds |
|-----------|-------|
| shows     | Raw, SmackDown, Dynamite, NXT. Rosters are uncapped and never expected to match in size. |
| wrestlers | name, gender, where they come from (WWE / AEW / NXT / Other — independent of which show they're on), alignment, active or injured, notes, current show |
| moves     | roster history: one row per change of show, with an optional note |
| teams     | two or more wrestlers. A wrestler can be on several; a team split across shows is allowed and flagged |
| titles    | singles or tag, a division, one show or none, can be retired |
| reigns    | title history. The reign with no end is the champion |
| seasons   | always exactly one active, each with its own week counter |
| events    | weekly episodes (one show) and premium live events (one show, or all), each holding its results |

A result lists its sides — each a set of wrestlers, plus the tag team they
wrestled as — and a win (with the winning side), draw or no contest, with an
optional finish, stipulation and title on the line.

Anything that happens at a point in time carries a stamp,
`{ season, week, seq }`: the universe's own calendar, plus a counter that only
goes up to order things inside a week. The History tab's timeline is *built*
from those stamps on the records rather than kept as a second log, so it can't
drift out of step with them.

What the model enforces, so the data stays trustworthy as it grows:

- **A failed change changes nothing.** Every function checks all its inputs
  before touching the universe, and the UI additionally snapshots and restores
  around each change. The reason comes back as a sentence for the owner.
- **Nothing is inferred.** A title changes hands only when the result says so
  ("the title changed hands"), because only the owner knows whether a DQ
  finish or a cash-in moved the belt.
- **History can't be pulled out from under itself.** A wrestler, team or title
  with any history can't be deleted — leave them unassigned, disband or retire
  them instead. A match or event where a title changed hands can't be deleted
  until that change is undone.
- **Title changes land in calendar order.** Backfilling a change into a week
  before the current reign began would crown the wrong champion, so it's
  refused. Match lists and the timeline sort by season and week, not by the
  order things were typed in.
- **Names are unique** (ignoring case and spacing) within wrestlers, teams and
  titles, which is what makes pasting a whole roster safe to repeat.

### Saving

Every change is saved to the browser straight away. The save menu (top right)
exports the whole universe as a JSON file and imports one back; that file is
the only backup, and how the universe moves between browsers or devices.

Import refuses anything that isn't a sound universe — wrong app, newer
version, or data that fails `validate()` — before touching what's there. A
stored save that can't be read on load is copied aside to
`wwe_universe_v1:unreadable-N` and never overwritten; if even the copy can't be
written, the section stays read-only rather than lose it. Saves carry a
`version`, and `migrate()` is where a future schema change will walk older
saves forward one step at a time.

### Not built yet, on purpose

Rankings, match booking, promotion/relegation and personality events are all
later work. The foundation is shaped for them — results already record sides,
winners, finishes and titles; roster moves already record who changed show and
when; seasons have hard edges — but none of that logic exists yet. There are
also no personality or relationship fields: those belong to the features that
will use them, and inventing their shape now would only mean migrating it
later.

## Layout

```
index.html      markup only
css/            one stylesheet per screen area, linked in cascade order
js/
  main.js       entry point: module order, window bridge, boot sequence
  state.js      the handful of values shared across modules
  store.js      localStorage persistence, roster rows, image downscaling
  data/         teams, league config, NFL player/schedule/colour tables
  markets/      Arc Markets — self-contained, see above
  universe/     WWE Universe — model.js (data + rules), persist.js (storage),
                app.js (commit, sheets), views.js, sheets.js, index.js (shell)
  *.js          one module per screen or subsystem
tools/          dev server and the verification harness
```

### How startup works

`js/main.js` imports every module in the order the original single-file script
ran them, then copies their exports onto `window` — the markup drives the app
through inline `onclick="..."` handlers, which resolve against the global scope.

Modules do no work at import time. Anything that used to run at the top level
(seeding the store, applying league defaults, painting the sidebar rail) now
lives in an `init*` function that `main.js` calls in order. This matters:
ES modules evaluate depth-first over the import graph, which does *not* match
source order, and the original code depended on source order.

### `js/state.js`

Nine values are rebound from a module other than the one that declared them.
An imported binding is read-only in ES modules, so those live as properties on
a single exported `S` object. Everything else stays module-local.

## The draft room

Sleeper's layout on purpose: owners across, rounds down, snaking, the whole
draft visible, tiles tinted by position. Density is deliberately unchanged — the
additions are metadata and history, not a new interface.

**On the clock** — the owner's column carries a timer above it, a tinted header
and a soft pulse on the pending cell. Nothing moves; it just becomes obvious.

**Badges** sit tiny in a tile corner and are configurable per league in
`draft-meta.js`: auto pick, clutch (submitted under a threshold, default 5s),
reach and steal (a threshold either side of ADP). Icons are swappable, each
badge can be turned off, and they are computed from the stored pick rather than
saved, so changing a threshold re-reads history rather than rewriting it.

**Reactions** are the point. Hold any tile to react; one per league member,
changeable until the next pick lands, then locked forever. Tiles show the top
three as bubbles along the bottom edge, tapping those opens the full breakdown,
and the whole thing is stored with the pick — so reopening a draft years later
still shows what the league said on the night. Holding rather than tapping keeps
the draft workflow intact: the common action stays one tap, and reacting is a
deliberate gesture that can't fire while scanning the board.

Each pick record is `{ id, ts, ms, auto, react }`. Older saves held bare id
strings; `migrateDraft()` lifts them on load.

## The live week and Rewind

`LIVE_WEEK` names the week that is currently being played; the user's own
matchup takes its score from the running lineup total rather than the seeded
schedule, and starters lock as their kickoffs pass.

Tapping either win % or the win bar opens **Rewind** — a win-probability chart
across the whole NFL week, 50% on the midline, the area filled green while you
lead and red once you trail. Scrub it to read the time, the score and the odds
at that moment; white dots mark scoring plays.

The axis only covers time when games are running. Kickoff windows are merged and
everything between them is dropped — no Saturday if nobody plays Saturday, no
Sunday morning, no Monday daytime before the night game. Dead hours would
otherwise be most of the chart: a week is about 7,500 minutes and only a third
of it has a ball in the air. For a drafted week that is 135 samples across five
windows instead of 744 across the whole calendar.

The series comes from the lineup rather than being drawn: each player's game has
a kickoff, their points land in two to four deterministic jumps across it, and
the chart samples every ten minutes **plus a point at the exact minute of every
scoring play**, so a score is never rounded onto the nearest tick. Those points
carry the scorer and the points gained, which is what the readout shows — a
typical week has ~46 scoring points, most of them off the ten-minute grid.
Dots are coloured by side: green for your players, red for the opponent's. That is what gives the line its shape —
flat overnight, jagged on Sunday afternoon when games overlap. Odds come from `winProbability(edge, rem)` in `js/clock.js`, shared with the
live hero so the two never disagree. `edge` is the expected-points margin,
`rem` the points still to be played — the uncertainty the margin is measured
against. As the last game ends `rem` reaches zero and the function returns an
exact 0 or 100, because by then the result is simply known. The previous
straight-line formula clamped at 1–99 and so never resolved.

Both were unreachable for a while: `LIVE_WEEK` was `0` while weeks run from
`MINW` (1), so `week === LIVE_WEEK` could never be true. The hero stayed at
0.0-0.0 however far the clock was stepped, and Rewind interpolated between
zeroes. The matchup screen had a second copy of the same mistake in its
`canRewind` check, which left the scrubber wired up only in the detail view.

## Verifying changes

The app is deterministic — no `Math.random`, no `Date.now` — so it can be
diffed against itself exactly.

```
npm start                                     # in one shell
npm run snapshot                              # dumps DOM for 32 interactions
node tools/pixel-diff.mjs <url-a> <url-b>     # screenshot comparison
```

The WWE Universe section has two suites of its own:

```
npm run test:universe     # data model + persistence, under Node — no browser
npm run check:universe    # the section driven in Chromium: typing, selects, confirms,
                          # a real export download and import upload, reload, geometry
```

`tools/snapshot.mjs` drives the app through every view and writes the resulting
DOM to one file per step. Diff two runs to see exactly what a change altered.

`tools/pixel-diff.mjs` compares rendered pixels. Three things had to be
controlled before it gave trustworthy answers, and all three produced convincing
false alarms first:

1. **Remote assets.** Player headshots and webfonts load from nfl.com and Google.
   When they are unreachable, each broken-image placeholder appears whenever its
   request happens to fail, so two runs of the *same* build disagree. The tool
   now aborts non-local requests up front to make that failure deterministic.
2. **The pulse animation.** The live-score dot loops every 1.8s, so its phase
   tracks wall-clock time. Animations and transitions are frozen before capture.
3. **Toasts.** They are `setTimeout`-driven; `#hint` is hidden before capture.

Even with all three controlled, expect a handful of pixels to differ by one unit
in one channel — the compositor rounds gradients and anti-aliased edges. The tool
reports `max delta` so you can tell a rounding artifact (1–2) from a real change,
and only counts pixels beyond that tolerance.

If a view still reports a difference, capture it *in isolation* before believing
it. Differences that appear only partway through the scripted sequence have so
far always been sequencing artifacts rather than real regressions.

## Where this came from

This started as a single 3,679-line HTML file. `tools/split.py` is the one-time
migration that produced the current layout; it reads the original file (the
first commit on this branch) and regenerates `css/`, `js/`, and `index.html`.
It is kept for provenance — day-to-day work happens in the split files.

## Known seams

- **Player data is embedded.** `js/data/nfl-players.js` holds ~900 players as a
  pipe-delimited string. That is the natural place to swap in a real feed.
- **Everything is on `window`.** Faithful to the original, but the surface is
  wider than it needs to be; narrowing it to an explicit handler list is the
  obvious next cleanup.
- **Scores are seeded hashes**, not real stats — deterministic per player/week.
