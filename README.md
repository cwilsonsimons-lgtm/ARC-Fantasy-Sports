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

`npm run check:markets` drives the section through 23 interaction checks. Several
assert *geometry*, not just DOM, because both bugs found here were invisible to
content assertions: a body state class that collided with the sheet element's own
class (applying `position:absolute; transform:translateY(102%)` to `<body>` and
sliding the app off screen), and a `.face` rule scoped so narrowly that a face
used outside a card or row rendered its headshot at full natural size. The check
also fakes a successful headshot load, so layout is tested the way a user with a
working network sees it.

## Matchup screen maker

`maker.html` is a separate tool, not a screen in the app: it builds the weekly
matchup graphics that get posted to the league chat. Open `dist/maker.html` by
double-clicking, or serve the repo and open
`http://127.0.0.1:8080/maker.html`.

The idea is that nothing about a screen's layout is decided per matchup. A
**template** is a background image plus a set of **slots** — one for each name,
logo, record, average and blurb — and every slot's position is stored as a
fraction of the canvas rather than in pixels. Position them once by dragging
them onto your background; every screen built from that template afterwards
puts the same thing in the same place. Because the coordinates are fractions,
the same layout survives a background swap, so the Thanksgiving and Christmas
versions are `Duplicate` plus a new picture rather than a rebuild.

The default layout keeps everything in a column down the **middle** of the
screen, both teams mirrored about the centre line, because the player cutouts
are added afterwards in another app and need the outer quarter of each side
clear. The stage footer reports exactly how much room is left — `clear for
photos: 510px left, 510px right` — recomputed from the live slots, so it is
never a guess. `Apply layout` swaps the whole template between that, a
scoreboard shape (names on the wings, numbers stacked in the centre) and a
wings shape (each team down its own side, middle left open).

**Backgrounds are a library.** `Import photos…` on the Template tab takes any
number of images at once, or drop them straight onto the canvas, or paste one.
They land in a strip of thumbnails shared by every template, so importing a
photo once covers the plain, Thanksgiving and Christmas versions — clicking a
thumbnail swaps the background under the slots without disturbing them, and the
canvas resizes to the photo so exports come out at its own resolution.

Two imports used to fail without saying anything, and both are worth knowing
about because neither looks like an error:

- **HEIC.** iPhones shoot HEIC by default and no browser decodes one in an
  `<img>`. The file was stored, `decode()` rejected, and the background silently
  never drew. Undecodable files are now refused with what to do about it
  (Settings → Camera → Formats → Most Compatible).
- **No IndexedDB.** With the image store denied — Firefox and Safari on a
  `file://` page, or any private window — the whole import rejected and nothing
  happened at all. Assets now fall back to memory, so an import works for the
  session and the tool says it will not survive a reload.

A **team** carries its logo, its typeface and its two colours. Slots ask for
those by role — `Team colour`, `Team's own typeface` — so a team that changes
its name or its font changes on every screen at once.

Text is written with tokens: `{{team}}`, `{{record}}`, `{{ppg}}`, `{{note}}`,
`{{score}}`, `{{rank}}` and the rest, resolved against whichever side the slot
belongs to. Type a final score on the **Scores** tab and every record, average
and standing recomputes from the results table — there is no second place to
update, and correcting a score typed wrong in week 3 corrects every screen made
after it.

Records shown on a preview are the records the teams *walk in with*: stats are
computed through the week before the one being drawn. "Records include this
week's results" flips that for a recap screen, which is also when the `{{score}}`
slots have anything to show.

### Nothing moves

The point of the tool is that a screen made in week 14 lines up with one made in
week 1, so no value is ever measured on its own. Three things were letting the
type drift, and all three are fixed:

**Text was sized to whatever it happened to hold.** A slot now has a *sizing*
mode. `Match both teams` (the default) sizes against the longer of the two names
on the screen, so both sides come out at one size. `Same size on every screen`
sizes against the longest name in the league — identical everywhere, at the cost
of sizing for the worst case. `Fit each value on its own` is the old behaviour
and is what wrapped blurbs use, since free text has no worst case.

Numbers never measure their own value under either locked mode: a record is
sized against `88-88` and a score against `888.88`, because 8 is the widest
glyph in almost every face. So a record does not change size when a team goes
from 3-2 to 12-4.

**The baseline came from the glyphs in the string.** `actualBoundingBoxAscent`
describes the letters actually being drawn, so `PPG: --` sat higher than
`PPG: 162.93`, and a name without a descender sat higher than one with a `g` in
it. Text is now anchored on the *capitals* of its face, and a locked slot is
laid out against the size it was asked for rather than the size it came out at
— so a screen whose names happen to fit larger still puts its baseline on the
same line as every other screen.

Matching pixel size is not matching visual size when every team picks its own
typeface: Bungee at 60px towers over Oswald at 60px. Slots that inherit the
team's face are matched on **cap height**, so the two names on a screen are the
same size to the eye and sit on one line even in two different faces.

**Outline and shadow were sized against the canvas.** Both are stored as a
fraction of canvas height so a template keeps one look at any resolution, but a
name that shrank to fit a long string got a 39px blur around an 8px letter and
vanished into its own halo. Both are now capped against the type size being
drawn.

The properties panel reports what a slot actually comes out at —
`Renders at 38px capitals` — which is the number you want when deciding whether
a box is too narrow for the mode you picked.

**Mirror** copies a slot's geometry across the centre line onto its opposite
number. Symmetry is the thing the eye catches on these graphics, and matching
two boxes by hand never quite lands.

Export writes a PNG at the template's own resolution — the preview is the same
renderer at a smaller scale, not an approximation of it. `Copy` puts the image
straight on the clipboard for pasting into a chat.

### Where the data lives

The JSON — teams, slots, schedule, scores — is in `localStorage`. Images and
uploaded fonts are not: ten logos and a few full-bleed backgrounds run past the
5 MB quota on their own, and a quota error there loses the whole save rather
than one picture. Those live in IndexedDB, and the state only carries asset ids.
`Data → Download backup` is the only copy that survives clearing site data or
moving to another machine; it inlines every image as a data URL.

Chrome and Edge allow IndexedDB on `file://` pages; Firefox and Safari do not.
Opening `dist/maker.html` there still works but forgets logos, so the tool says
so and points at `npm start`.

### Two traps worth knowing

**`$$` did not survive bundling.** The UI helpers were originally `$` and `$$`;
esbuild emitted both as `var $` in `dist/maker.html`, so every `$$` call in the
built file silently became `querySelector` and returned one element instead of a
list — the tab bar stopped responding, and only in the built file. They are
`qs`/`qsa` now.

**Canvas has no `font-display: swap`.** If a webfont is not loaded when
`fillText` runs, canvas draws the fallback and never redraws. Every face is
requested up front in `js/maker/main.js` before the first draw.

`npm run check:maker` runs 39 checks against the built file. Several read
pixels rather than the DOM, because what goes wrong in a layout tool is
geometry: they draw a slot on its own, diff it against the same template with
everything hidden, and assert the ink landed inside the box it was positioned
in — including with a team name long enough to force a shrink. Two more read the
renderer's own trace to assert the guarantee directly: both names on a screen at
one size on one baseline, and a record the same size at 3-2 and at 12-11.

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
  maker/        the matchup screen maker, entry js/maker/main.js
  *.js          one module per screen or subsystem
maker.html      the screen maker's own page
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
npm run check:markets                         # Arc Markets interactions
npm run check:maker                           # the matchup screen maker
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
