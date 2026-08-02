# City Boys Dynasty

Fantasy football league app prototype — matchups, standings, rosters, a mock
draft room, free agency, and a simulated live-scoring week clock.

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

## The league hub

The app opens on a **hub** (`data-view="home"`), not inside a league. The hub sits
above league scope, so `.leaguebar` and `.tabs` — which are league chrome — do not
render there at all; `body.hub` hides them.

`js/leagues.js` holds the four leagues. City Boys Dynasty is the real one: its
teams are `T`, its roster is the live `LINEUP`, its draft is the draft room, and
`openLeague('cbd')` puts you exactly where the app used to start. It carries no
fixed status — `leagueStatus()` derives it from `draftDone()`, so it reads
pre-draft (and counts down) until you draft, then flips to active with a live
score.

The other three are **seeded**: their own teams, records and scores, rendered
read-only. They reuse the same renderers rather than copies of them —
`stadiumStageHTML` and `stadiumHeroHTML` take an `opts.teams` map that defaults
to `T`, so one edit still changes every matchup surface at once. Nothing a
seeded league draws writes back. Two leaks were caught here and are now asserted
against: assigning `S.week` from a seeded league moved the real league's week,
and the shared `#userHero`/`#userLineup` containers kept seeded markup after
returning, because `showTab` only re-renders team and draft.

Rows reorder by drag handle (pointer events, not HTML5 drag — that never fires
on touch) and persist to `store.leagueOrder`.

## Chat owns trades

There is no DM inbox and no trade tab. `store.chat[leagueId]` is one log; a
message with a `to` belongs to a one-to-one thread, one without it is league-wide,
and `renderChat()` draws both. A thread starts from the other manager's team
screen — that is the only entry point, by design.

Trades render as cards inside that log, with Accept / Counter / Decline. A
counter reopens the builder pre-filled from the recipient's seat and carries an
optional note, so the "add a second and a fourth" round-trip stays in the app.
Accepting posts a system message and auto-attaches a *who won this trade* poll.

**Draft picks are assets**, not an afterthought: they sit in the same columns as
players and can carry a condition (`{trigger, value, upgradeTo}`) — a 2nd that
becomes a 1st if the acquiring team reaches the championship. Picks only;
a conditional player would be a rules bug rather than a feature. A condition is
stored against the pick in `store.pickConds`, not against the card, so it follows
the pick everywhere it appears afterward. `assetChipHTML()` is the single chip
used by the builder and by every trade card, which is what makes that true.

The evaluator strip docks to the bottom of the builder and reads from
`js/values.js` — a static, local KeepTradeCut-style table, with an ADP curve
behind it so all ~900 players have a number rather than a hole. A conditional
pick prices between what it is and what it becomes.

## Notifications

`store.notifs`, a bell in `.leaguebar`, and `data-view="notifs"`. This is the
*only* surface for anything the clock drives — there are deliberately no waiver
banners, recap ribbons or dashboard strips anywhere else, and `hub-check`
asserts their absence on every visible view.

Generators read the device clock and dedupe through a key, which is what keeps
"one notification per waiver window" honest across reloads. Claims open when the
previous batch processed rather than 24 hours before the next one — otherwise
the window is a sliver and the centre reads empty most of the week. Waiver
timestamps are dated as well as local: a window that opens and closes on the same
weekday renders as the same instant twice without the date.

Per-type toggles live in Settings ▸ Alerts. They are personal, never league
policy, so they skip the commissioner `guard()` — which is why the settings tab
list is no longer a fixed length.

## Arc Markets

The **Markets** item in the bottom nav opens Arc Markets — a separate section, not
another fantasy screen. It takes over the whole phone with its own header, the
same four colours a step darker, its own bottom nav and its own `localStorage` key
(`arc_markets_v1`). "Leagues" in its nav returns to the fantasy app.

The code boundary matches the product boundary: `js/markets/` imports only from
`js/data/` (plain NFL facts — players, teams, colours) and never touches league
settings, rosters, lineups or scoring. The only seam is `openMarkets()`, which
adds a class to `<body>`.

**The tradeable universe** is `js/markets/universe.js`. `ELIGIBLE` is the top
`UNIVERSE.SIZE` fantasy scorers at skill positions from the prior *completed*
season — real nflverse PPR totals out of `js/data/nfl-history.js`, not
projections — computed once at load and frozen. A player outside it is not
listed-and-restricted, he is absent: there is no row and no quote.
`canRecompute()` is the gate, and it refuses in-season by design.

Within the 100, the top `BLUE_CHIP_SIZE` carry `BLUE_CHIP_YEARS` and the rest
carry `STANDARD_YEARS`, which is what the SEASON CONTRACTS strip draws.

One consequence is worth naming: **a rookie can never be tradeable.** He has no
prior completed season, so he cannot finish top 100 in one. The Market screen's
fourth highlight card used to be "Rookie Buzz" and would have fallen back to a
veteran under a rookie label; it now asks a question the universe can answer —
the best mover among the youngest contracts listed.

**Positions come only from executed orders.** `js/markets/orders.js` folds the
order book into a position and nothing else creates one — a player on your
fantasy roster grants zero shares, and `orders-check` asserts exactly that by
drafting a roster and confirming the untraded names still hold nothing. Holdings
used to be seeded as a table beside the market; that is gone, and the seed is a
list of fills.

A position is **one signed integer**. Long is positive, short is negative, and a
single order may cross zero: own 5, sell 6 nets to −1, and the remainder
reprices at the fill. There is no Short button, no Cover button and no separate
short ledger to reconcile against. Order entry lives behind the docked TRADE bar
and nowhere else — the bar is a sibling of the sheet rather than a child,
because the sheet is itself the scroll container and a bar inside it parks
mid-content instead of docking.

**No currency marks anywhere in the section.** `money()` returns a bare number;
`orders-check` fails on a single `$` in the rendered DOM.

**The pricing model** comes from the concept brief: a contract settles on the
player's official season production at **100 points per dollar**, so a player
projected for 328 points prices near $3.28 and pays out their real total ÷ 100 at
season end. Prices are therefore derived from real projections rather than copied
from the mockups, which keeps the whole market internally consistent. Day moves,
trade counts and sparklines are seeded from each player's id, so the numbers are
stable across reloads and screenshots.

Deliberately *not* faked: the News and History tabs are empty states rather than
invented headlines about real players.

`npm run check:markets` drives the section through 23 interaction checks, and
`npm run check:orders` adds 45 for the order book, net positioning, portfolio
independence and the universe. The hub, chat and notification surfaces have
their own 62 in `npm run check:hub`. Several
assert *geometry*, not just DOM, because both bugs found here were invisible to
content assertions: a body state class that collided with the sheet element's own
class (applying `position:absolute; transform:translateY(102%)` to `<body>` and
sliding the app off screen), and a `.face` rule scoped so narrowly that a face
used outside a card or row rendered its headshot at full natural size. The check
also fakes a successful headshot load, so layout is tested the way a user with a
working network sees it.

## Colour

Four colours, in `:root` in `css/base.css` and again (a step darker) in `.mk` in
`css/markets.css`:

```
Graphite  #3A3335      Coral     #F05D5E
Shamrock  #329F5B      Platinum  #E7ECEF
```

A dark UI needs more than four steps, so the surfaces are Graphite's hue carried
down toward black and the ink is Platinum carried down to a mute. Graphite
itself lands on `--line` — the edge between two dark surfaces is what it is best
at.

**Shamrock is the accent and the positive direction, deliberately.** One brand
hue is all four colours allow, and in a sports app green already means live,
ahead and go. Coral is kept strictly negative, so a red number never means
anything except down. The old `--violet` and `--mk-blue` are gone; the variables
are `--accent` and `--mk-accent`, because a name that holds a hue goes stale the
first time the hue changes.

Two places needed a decision rather than a substitution:

- **Trade card status.** Five states, no spare hues. Both open states are
  neutral Platinum because they are waiting on you — one outlined, one filled —
  and only the outcomes take the directional pair. The word in the pill carries
  the rest.
- **The deal evaluator.** The brief asked for a red/yellow/green bar and the
  palette has no yellow, so the middle band is Platinum. The scale measures
  fairness rather than direction, and a neutral colour for "drifting" reads
  correctly.

Two colour sets are deliberately *not* on the palette. Team identities (`T`,
and the seeded leagues in `js/leagues.js`) stay varied — flattening ten managers
to four colours would delete the thing that makes a crest recognisable — except
that the user's own team is Shamrock in every league, which is what makes the
hub read as "these are all mine". Position colours (`POSCOLOR`) stay distinct
for the same reason: QB/RB/WR/TE is a taxonomy, and four palette colours cannot
carry six categories. NFL team colours in `js/data/nfl-colors.js` are facts.

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
