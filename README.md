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

`npm run check:league` drives the median, the league logo's geometry and
stacking, the draft clock, the trade block and the schedule through 40 checks
against `dist/index.html`. `npm run check:markets` drives the Markets section
through 23 interaction checks. Several
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

## League median scoring

**Settings ▸ General ▸ League median.** Off by default, and off for every league
saved before the setting existed — `LEAGUE_DEFAULTS` carries `median:0`, and
`initLeagueConfig()` already merges defaults under the stored league, so an old
save migrates by simply not having the key.

With it on, every team plays two opponents a week: the one on their schedule and
the league itself. Score above the median and you bank a second win; below it, a
second loss. A matchup page then shows both results for both teams, the standings
count both in the W-L column and break the median half out into its own, and a
team's schedule lists the median result beside each week's game.

`js/median.js` derives all of it and stores none of it. Records are computed from
the same scores the matchup cards draw, so turning the setting on or off re-reads
the season rather than rewriting it — which is what makes it safe to toggle
mid-season. Two details that only show up in a part-played week:

- The median is taken over the scores that **exist**. A game still to be played
  is not a zero; counting it as one drags the median to the floor and hands a
  free win to everyone who has kicked off.
- A team is measured against the median only once **their own** game is played.
  Otherwise a team sitting at 0.0 before kickoff ties a zero median and banks a
  result it never played for.

## The league logo

The centrepiece of every matchup card and of the full matchup screen: dead
centre, behind the VS and the score, in front of nothing but the backdrop.
Uploaded in **Settings ▸ Matchups ▸ League Logo**; a league that has not uploaded
one falls back to the shield from the header, so the centre is never empty.

It is a child of the **centre column**, not of the card, because that column is
the one element in the arena whose midline cannot move: it sits between two
`flex:1` sides, so it grows symmetrically about its own centre. The logo
therefore stays on the card's exact midline however long the team names run,
whatever size the team logos are, and however wide the score gets. Anchoring it
to the card — or worse, to the stage, which also carries the header and the nav —
is what previously put the crest off to one side and up over the team logos.

Layer order is fixed by three z-indexes and nothing else:

```
backdrop  →  league logo  →  VS + score  →  team logos, names, records, win %
   0–1            0                1                     2
```

The sides outrank the centre column, so the logo cannot come over a team's own
artwork or text even when the artwork is wide. A radial mask feathers the rim and
a soft well in the middle keeps the score legible over any uploaded image.

`tools/league-check.mjs` asserts the geometry rather than the DOM — it measures
the distance between the logo's centre and the centres of the card, the VS and
the score, and re-measures after swapping in the longest and shortest team names
in the league. A crest that is correct in the markup but anchored to the wrong
box passes a content assertion and fails these.

### Team names are never cut off

They used to run through one line with an ellipsis, so half the league read as
`RADIATOR SPRIN…` on every card. They now wrap, and `overflow-wrap:anywhere` also
shrinks the element's min-content width, so even an unbroken 30-character word
fits its column instead of spilling out of it.

`fitTeamNames()` then keeps a wrapped name from becoming a five-line tower by
stepping the type down until it sits in three lines or fewer, and squares the two
sides of a card off to the taller of the pair so the records and win % underneath
stay level. It measures rather than deriving a size from the length of the name,
because the thirteen team typefaces differ by more than 2x in width per
character — a name that fits on one line in Oswald needs three in Press Start 2P.
A hidden view measures as zero, so `showView()` re-fits whatever just became
visible. The check drives 6 names × 13 typefaces and asserts the rendered text
still equals the name that was set.

## The trade block

Listing a player and saying what you want back are one action, not two. The
**Looking For** sheet opens the moment a player is added, because that is the
only moment the owner is actually thinking about the trade; asking them to find a
second screen afterwards is how trade blocks end up as a wall of names with no
context. Five presets, a free-text field, and a Skip that still lists the player.
The answer shows on the player's card whenever anyone taps them, is editable from
there, and the Trades rail lists everyone currently on the block. Dropping a
player takes them off it.

## The draft room

Sleeper's layout on purpose: owners across, rounds down, snaking, the whole
draft visible, tiles tinted by position. Density is deliberately unchanged — the
additions are metadata and history, not a new interface.

**On the clock** — the countdown lives in the Current Pick card, not over the
board: owner, `Pick 1.04`, and the time left, with the clock the loudest thing on
the card because it is the only part that is moving. It reads `mm:ss` with both
halves padded so it never changes width as it runs down. The board keeps its
tinted header and the soft pulse on the pending cell, so it still says whose turn
it is without a second timer.

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
