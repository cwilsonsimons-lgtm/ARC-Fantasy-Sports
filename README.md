# Summit

Fantasy football app prototype, built around the City Boys Dynasty league —
matchups, standings, rosters, a mock draft room, free agency, and a simulated
live-scoring week clock.

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

### Logo

`assets/summit-logo.png` is the Summit logo as supplied. The page embeds a
cut-out of it (the black background made transparent) once, as the
`.summit-mark` class, so it still renders with no network; `assets/summit-mark.png`
is a large copy of that cut-out, and `assets/summit-icon-180.png` and
`summit-icon-512.png` are the home-screen and browser icons (the mountains on
black).

## Trades

A trade can be started from wherever the other team is: **Propose a trade** on
their team page, **Trade for** on one of their players' cards (he is already in
the offer), **Make an offer** on their player in the Trade Block, the trade
button in a private chat with them, or **Trade** in the Trade Block, which opens
on a row of every other team to pick from. That row stays across the top of
the builder, so the partner can be switched at any time (what was picked from
the last team is dropped; what you give is kept). A counter-offer stays with
the team that made the offer. Back returns to where the trade was started.

A trade graphic is offered once a trade is accepted (agreed and under league
review, or processed), never for an offer or a counter-offer. On it every team
name is set in that team's own font and colour:
the wordmarks, the heading over what each side receives, and a pick's
"via <team>". `node tools/trade-partner-check.mjs` checks all of this.

## Header and inbox

Every league screen has the same header: the league on the left (tap it for
the home screen), then chat, notifications and the menu on the right. The
matchup screen draws its own header over the backdrop but in the same order.
There is no back arrow; the Matchup, Team and League tabs, the league name and
each screen's own controls (a player card's close button, the trade builder's
back) get you around.

Chat, notifications and transactions are one place with three tabs: the chat
button opens it on Chat, the bell on Notifications, and Transactions holds the
league's transaction log. Each tab shows its unread count. A conversation with
one manager keeps the tabs, and Chat returns to the league chat. The side
menu no longer has Chat or Transactions. `node tools/nav-check.mjs` checks the
header on every screen, the side menu and the inbox.

## Side menu

Leaders opens on this season's top scorers: real points under the league's
scoring, highest first. Projections, a single week and past seasons are still
in its two pickers, but every time the menu opens on Leaders, or Leaders is
tapped in the rail, it goes back to this season's points. Another panel left
open stays the one the menu opens on. `node tools/leaders-check.mjs` checks it.

## Markets

The **Markets** item in the bottom nav opens Markets — a separate section, not
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

## Layout

```
index.html      markup only
css/            one stylesheet per screen area, linked in cascade order
js/
  main.js       entry point: module order, window bridge, boot sequence
  state.js      the handful of values shared across modules
  store.js      localStorage persistence, roster rows, image downscaling
  data/         teams, league config, NFL player/schedule/colour tables
  markets/      Markets — self-contained, see above
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
a kickoff, each scoring play lands whole at its real moment, the rest of their
points (yards, catches, first downs) come in steadily over the game, the odds
run in straight lines between the moments that move the matchup (kickoffs,
scoring plays, game ends), and
the chart has **a point for every minute a game is being played**, and the
scoring plays land on their own minute. Those points carry the scorer and the
points gained, which is what the readout shows — a typical week has ~46
scoring points. The line is drawn from the unrounded odds, so a minute-by-minute
line does not climb in whole-percent stairs; the readout shows whole percents.
Dots are coloured by side: green for your players, red for the opponent's. That is what gives the line its shape —
flat overnight, jagged on Sunday afternoon when games overlap. Odds come from `winProbability(edge, rem)` in `js/clock.js`, shared with the
live hero so the two never disagree. `edge` is the expected-points margin,
`rem` the points still to be played — the uncertainty the margin is measured
against. As the last game ends `rem` reaches zero and the function returns an
exact 0 or 100, because by then the result is simply known. The previous
straight-line formula clamped at 1–99 and so never resolved.

The horizontal scale is game minutes: time within each window, with every gap
between windows drawn as ten minutes. In the live week the chart runs to now
while a game is on; between games (Sunday night until Monday's kickoff) it ends
on the last minute played and the time over it says so, rather than drawing
the night as a flat line up to the clock. A game running past its usual
length (overtime) keeps it going.

**Zoom.** Tapping the time at the chart's top left opens a menu: the whole
week, then the week's kickoff slots, TNF, 12PM, 3:05PM, SNF, MNF (a Sunday
slot goes by its time, another day's by day and time; kickoffs within half an
hour, like 3:05 and 3:25, are one slot), each with the stretch it covers. A
slot runs until the next one kicks off, so 12PM is the noon games from noon to
3:05. Only slots one of the matchup's starters kicked off in are offered, and
in the live week only those already under way, ending on now. Two fingers zoom
to any stretch, and back out to the whole week (ctrl + wheel, a trackpad pinch,
does the same on a computer); the menu then lists it as "Your stretch".
Zoomed, the time is outlined, the axis reads the clock, the cursor goes to the end of the stretch
and the lineup follows it, and a line under the chart gives each side's points
over the stretch and the odds at either end. The zoom holds through live
updates and the week's other games; another week opens on the whole week.
`node tools/chart-zoom-check.mjs` covers it.

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
