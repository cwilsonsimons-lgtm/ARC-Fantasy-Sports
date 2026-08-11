# What this app actually is

This document exists because scope kept getting lost between working sessions.
The repository is **not** the full app. The full app is
`prototypes/1stPrototype.html` — a single self-contained build, 15,501 lines,
containing 46 JavaScript modules and 23 stylesheets. Anything described below
that is marked *prototype only* has never existed in `js/` or `css/` here.

Read this file before planning work. Read the prototype before implementing it:
it is the specification, and it runs — open it in a browser.

## How the two diverged

`git log` starts with a 3,679-line single-file prototype (246 KB), split into
modules in the second commit. Every commit since has refined that smaller
starting point. The prototype in `prototypes/` is a **later, much larger build
from a different line of work**: 1.4 MB, and it contains everything this repo
has plus roughly twenty subsystems this repo has never had.

The repo is behind, not ahead. The one place the prototype is genuinely
*different* rather than simply larger is navigation — see "Navigation shell"
below.

## Navigation shell

The prototype puts a **home hub above league scope**. You land on a list of your
leagues; you open one; a back chevron in the header (`.hubback`) returns you to
the hub. Header back labels are set with `setBackLabel()` on that one chevron.

This repo has no hub. It boots straight into a single hard-coded league and
draws back-navigation as in-page labelled bars (`teamBackLabel`,
`playerBackLabel`, `setBackLb`). Those three element ids are the only things in
this repo that the prototype does not have — they are the older pattern, not a
newer feature.

Bottom nav in both: Matchup · Markets · Feed · Profile (Feed and Profile are
deliberate "coming soon" toasts). A left drawer holds a rail of panels: Chat,
Trending, Available, Leaders, Trades, Transactions, Scores, News, Settings.

## Subsystems

### Present in this repo

Matchup view with stadium hero and live-score simulation, week switcher and week
picker, league/all-matchups view, standings, team view (crest, colours, one of
13 display fonts, player photos and nicknames), player cards with weekly logs
and past-season leaders drawn from `data/nfl-history.js`, lineup with slot
eligibility and swap sheets, free agency add/drop, the mock draft room (board
grid, pick badges, reactions, clock), Rewind (win-probability chart with
touchdown markers, axis clamped to kickoff and final whistle), settings that
everyone reads and only the commissioner writes, and Arc Markets as a
browse-only section.

### Prototype only

**League lifecycle**
- `home.js` — the hub: reorderable league list (drag by grip), per-league status
  line, live score or draft countdown or join progress per row.
- `leagues.js` — multi-league model. Four seeded leagues in four different
  states: `cbd` (the real, fully-simulated one), `sunday` (active, week 9),
  `midway` (pre-draft with a countdown), `hallmark` (complete, 1st place).
  Non-real leagues render from seeded hashes rather than the full engine.
- `create.js` — a six-step create-league wizard (name, source, type, size,
  draft, review), resumable from the hub, generating teams, an invite token and
  an invite link.
- Waiting room for a league still filling: invite sheet, copy link, "simulate a
  join", start-draft when full.

**Transactions**
- `trade.js` + `values.js` — a full trade builder. Two-sided asset columns of
  players *and* future draft picks, a trade-value model (`VALUES`, `pickValue`
  with `PICK_BASE` by round, `verdictFor`), conditional picks with triggers, and
  counter-offers with notes.
- `chat.js` — league chat that is also the trade transport. Trade cards post
  into the thread with status pills (proposed/countered/accepted/declined/
  expired), league polls with votes, unread badges, and `validateTrade` /
  `applyTrade` with a roster fingerprint guard.
- `waivers.js` — rolling, reverse-order **and FAAB** waivers. Budgets, minimum
  bids, claim ordering and reordering, a waiver clock and period, AI-seeded
  competing claims, and `processWaivers` resolving them with tie-breaks.
- `log.js` — a transaction log: trades, draft picks, adds, drops, waivers,
  commissioner moves.

**Commissioner tools** (`commish.js`, `draft-edit.js`, `draft-history.js`)
- Move any player or pick between rosters, with roster-cap and bench-space
  checks.
- Score overrides per team per week; clear a week; reset all.
- Assign, undo or replace any draft pick after the fact.
- Archive a completed draft; league history and draft history cards.

**Scoring** (`scoring.js`, `scoring-ui.js`, `data/scoring-rules.js`,
`data/scoring-presets.js`)
- A complete scoring editor: every rule categorised (passing, rushing,
  receiving, kicking, defence, special teams) with help text, yardage rules
  expressed as yards-per-point, search across rules, dirty-state tracking, and a
  live preview scoring real sample stat lines.
- Named presets, defaulting to `sleeper`, with reset-to-preset.

**Notifications** (`notifs.js`)
- A notification centre with a bell badge, six preference types (waivers open /
  closing / results, weekly recap, draft clock, trades), generators that raise
  them from league state, and deep links into the originating screen.

**Settings depth**
- Nine tabs: General, Roster, Scoring, Playoffs, Schedule, Matchups, League
  History, Draft History, Alerts. Includes a playoff bracket editor (seeds,
  byes, pairings, round names), a schedule editor that can swap home/away per
  week, roster-shape editing that reseats players when slots change, league
  crest upload, and commissioner handover.
- `LEAGUE_DEFAULTS` covers league type (redraft/keeper/dynasty), lineup mode
  (classic/bestball), waiver mode and timing, trade deadline, playoff shape, and
  a standings mode.

**Standings modes** (`kart.js`)
- `record`, `table` (three points for a win) and `kart` — finish-order points
  per week, Mario-Kart style, which also relabels the Matchup tab to "Week".

**Arc Markets trading** (`markets/orders.js`, `markets/ticket.js`,
`markets/universe.js`)
- The repo's Markets is browse-only. The prototype trades: a buy/sell ticket
  (market and limit, quantity stepper, review then confirm), an order book in
  `localStorage`, positions computed from order history with average cost,
  realised and open P/L, `$25,000` starting cash and buying power, and a
  portfolio view with tabs and sorts.
- `universe.js` defines contract eligibility — prior-season rank, contract years
  and tier, and when a contract may be recomputed.

## Module map

Prototype modules with **no counterpart** in this repo:

```
js/home.js            js/create.js          js/leagues.js
js/chat.js            js/notifs.js          js/log.js
js/trade.js           js/values.js          js/kart.js
js/commish.js         js/draft-edit.js      js/draft-history.js
js/waivers.js
js/scoring.js         js/scoring-ui.js
js/data/scoring-rules.js                    js/data/scoring-presets.js
js/markets/universe.js  js/markets/orders.js  js/markets/ticket.js
```

Stylesheets with no counterpart: `home.css`, `create.css`, `scoring.css`,
`chat.css`, `notifs.css`, `log.css`.

## Storage

- `cbd_team_v1` — the fantasy app (rosters, lineups, leagues, chat, notifs,
  trades, claims, transaction log, scoring, settings).
- `arc_markets_v1` — Arc Markets, kept deliberately separate.

Both are versioned and carry migrations (`migrateRosters`, `migrateDraft`,
`migrateTrades`, `migratePlayerStore`, `migratePlayerLeagues`).

## Reading the prototype

It is one file with a build banner per module — search for `// js/<name>.js` to
jump to a subsystem, and `/* css/<name>.css */` for its styles. Note that
esbuild emits some modules twice (declarations first, then the implementation
block); the second occurrence is the one with the bodies.

The base64 font payload near the top is noise. To read it comfortably:

```
awk 'length($0) > 2000 { print "<<<omitted>>>"; next } { print }' \
  prototypes/1stPrototype.html > /tmp/proto.txt
```
