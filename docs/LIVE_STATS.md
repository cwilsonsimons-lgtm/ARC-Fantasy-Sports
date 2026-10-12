# Live stats

The app runs on real 2026 NFL data. Everything lives in the `js/live.js` block
of `1stPrototype.html`.

## Sources

Both send `Access-Control-Allow-Origin: *`, so the phone fetches them directly.

| What | URL |
|---|---|
| Weekly stats (live during games) | `https://api.sleeper.com/stats/nfl/2026/<week>?season_type=regular` |
| Weekly projections | `https://api.sleeper.com/projections/nfl/2026/<week>?season_type=regular` |
| Game state and clock | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=<week>&seasontype=2` |
| Scoring plays (for the Rewind) | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=<id>` |

The development container cannot reach these hosts, so their real responses
were captured by a one-off GitHub Action: shapes in `docs/probe/`, trimmed
QB/RB/WR/TE fixtures in `tools/fixtures/live/` (Sunday of week 4, games in
progress). `node tools/live-check.mjs` runs the app against them, with the browser clock
pinned to that afternoon.

## How it fits

- **Current week** (`LIVE_WEEK`): the week whose first kickoff to last game
  (+4h) holds now, else the next one. Kickoffs are Eastern (`kickOrd`).
- **Locks**: `simKick()` returns the real clock as an ord, so a player locks at
  their own game's kickoff. Before the week's first game nothing is locked.
- **Points**: Sleeper records are matched to the app's GSIS ids by name and
  position (fallback: surname + team + position), translated to the app's stat
  keys (`LV_MAP`, yardage bonuses derived as before) and scored by
  `scoreStats`, so each league's scoring applies. `pLive`, `statLineFor`,
  `seededScore` (team scores, other matchups, standings) and `wkProj` all read
  these. A player with no line scores 0; nothing is invented.
- **Projections**: Sleeper's, scored the same way, replace `proj` per week.
- **Refresh**: every ~60s while a game in the live week is on; finished weeks
  are cached in `localStorage` (`arc_live_v2`).
- **Win %**: remaining projection is scaled by how much of each game is left
  (ESPN period and clock).
- **Rewind**: each touchdown a starter scores or throws lands at its real game
  time and is the only kind of marker on the chart (scorer = the name ESPN's
  play text starts with, passer = "pass from <name>"; names in the bracketed
  extra point or two-point try do not get the touchdown). A marker is worth
  the whole play under the league's scoring, not just the touchdown: its yards
  (from the play text; a lateral's legs are added up for the passer), the
  catch, carry or completion, per-play distance bonuses (catch length, 40+
  yard plays and TDs) and a good two-point try he threw, caught or ran, which
  is also its own "2-PT" marker when the touchdown was someone else's. The
  bubble and the stats sheet show what it was for ("+6 TD · +2.2 yardage ·
  +1 bonus"). A touchdown is not a first down in these stats, and game-total
  bonuses (100 yards and the like) are not tied to one play. The rest of a
  player's points (and anything negative) accrue, unmarked, through the part
  of his game played, so every chart still ends on his total. For the
  live week the chart ends at now, on the live score and the card's odds.
- **Every matchup has a chart**: All Matchups shows a win-chance strip on each
  card (above the midline the left team leads, below it the right, in team
  colours); tapping it opens that matchup with the full chart, and its lineup
  follows the chart's minute like your own. An imported league's finished weeks
  chart, and list, the starters each team actually used (Sleeper's record), so
  the lineup, the chart and the final agree. Scoring plays
  are fetched for every team's games, and a game's summary is re-fetched only
  when its score changes.
- **Locks** compare a player's kickoff to the real time, so past weeks are
  always locked and later weeks open.
- **Stat lines**: once a player's game kicks off (ESPN says it is in progress
  or over; a finished week counts as played), the line under his name stops
  naming the opponent and kickoff and shows his box score in one line
  ("7 rec 82 yd 1 TD · 1 car 4 yd"), with a green dot while the game is live.
  Before kickoff, and on bye, it is the schedule as before. Demo leagues, whose
  points are scaled projections, keep the schedule.
- **Stats sheet**: tapping a player's points opens his week: the game's status
  and score, a box score (targets and longest plays come from the same Sleeper
  feed and are display only), each scoring rule that applied with its count,
  value and points, the total (the same number as the row), and his
  touchdowns with quarter and clock from ESPN's play-by-play. For an imported
  league the total is Sleeper's; anything it holds that the app does not
  itemize (kickers, defenses, unmapped rules) shows as "Other scoring per
  Sleeper". Before kickoff the sheet shows his projection the same way.

## Links, records and schedules

- **Player names** are links everywhere they appear (matchups, bench, swap
  sheet, stats sheet, draft board and pick sheets, recent picks, draft
  history, trade builder and trade cards, transactions, commissioner roster
  tools, drop confirmation): `plink()` marks them with `data-pc`, and one
  capture-phase click handler opens the player card before any action of the
  row underneath. Rows that select or swap keep doing so everywhere except on
  the name. A held draft tile (reactions) is not treated as a tap. Back from
  the card returns to the same screen, scroll position and open sheet.
- **Records** are links (`rlink()`, `data-sched`) in the matchup header, the
  team page, every standings mode and the schedule itself; each opens that
  team's schedule: every week's opponent and their record, the result and
  score, the live score, or the odds ahead. A week opens its matchup.
- **Records are computed** for leagues the app runs (`syncRecords`): each
  finished week's score against that week's opponent, ranked by wins (a tie
  counts half) then points for. Imported leagues keep the host's record.
- **A league made after week 1** starts 0-0 and counts only what happens from
  the moment it was made (`leagueStart`, `counts`): earlier weeks score 0 for
  it, and in the week it was made a player counts only if his game kicked off
  after that moment (his row reads "Before league" and his points are 0).
  City Boys and imported leagues count the whole season.
- `node tools/link-audit.mjs` walks 47 screens and sheets across City Boys, a
  league mid-draft and the imported league, and fails on any visible player
  name or record that is not a link; it also checks the taps themselves.
  `node tools/league-start-check.mjs` checks the mid-season start rule.

## Known gaps

- The made-up demo leagues on the home screen have no schedules, so their
  records are not links. Markets keeps its own player sheet.
- Kickers and defenses are not on rosters, so their stats are not mapped.
- A handful of players whose names differ between sources may not match
  (about 3% of scorers in week 3).

## Sleeper league import

**By username (the usual way in).** Import from Sleeper asks for a Sleeper
username. `GET /v1/user/<username>` gives the account and
`GET /v1/user/<user_id>/leagues/nfl/<season>` its leagues for the season; each
listed league imports with the roster that account owns or co-owns as "my
team", so there is no league ID and no picking. An account that is not on any
team in a league picks from the list. The username is kept in the store (it
travels with the signed-in account), so the next import opens straight on the
list, where leagues already brought in read "Open"; "Not you?" forgets it. A
league ID still works from the first screen, and with the username known the
user's own team leads that list, marked "You". `node tools/sleeper-user-check.mjs`
covers the flow.

**What the import does.**

Either way, the league becomes a created league (`js/sleeper.js`)
whose teams, records, roster spots, rosters (starters, IR, taxi, bench) and
weekly schedule come from Sleeper's public API:

| What | URL |
|---|---|
| League | `https://api.sleeper.app/v1/league/<id>` |
| Managers / team names / avatars | `.../league/<id>/users` |
| Rosters, records | `.../league/<id>/rosters` |
| Pairings and points | `.../league/<id>/matchups/<week>` |

Every score in an imported league is Sleeper's own (`players_points`,
`points`), so it matches the Sleeper app to the hundredth under the league's
own scoring. Rosters and the live week's matchups re-sync when the league is
opened and with the live refresh (every ~60s during games); league settings
and managers re-sync every few hours. Sleeper has no write API, so changes made
here (lineups, trades) do not reach Sleeper and are replaced at the next sync.

Sleeper ids map to the app's players through `SLEEPER_PLAYERS` (built from
Sleeper's full player list, `tools/fixtures/sleeper_players.json`), then by name
and position. Rookies missing from the app's player pool still show with their
name and Sleeper points. `node tools/sleeper-check.mjs` imports the real City
Boys Dynasty league from `tools/fixtures/league/`.
`node tools/stat-check.mjs` checks the stat lines and the stats sheet against
the same league and Sleeper's week 3 and 4 numbers.
