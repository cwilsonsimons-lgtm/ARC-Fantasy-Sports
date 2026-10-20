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
  Their first downs are not real projections: every row has them at a tenth
  of the yards (`rec_fd = rec_yd / 10`, the same for rushing and passing),
  about 2.4 times what players get. `lvProjFix` puts in this season's real
  rates instead (one receiving first down per 24 yards, one rushing per 19,
  one passing per 24), so a league that scores first downs is not projected
  ~25% high. Stats rows are left as they are.
- **Refresh**: every ~60s while a game in the live week is on; finished weeks
  are cached in `localStorage` (`arc_live_v2`).
- **Injuries**: every Sleeper projection and stats row carries the player's
  current record, with `injury_status` (Questionable, Doubtful, Out, IR,
  PUP, Sus, DNR, NA; null when healthy), `injury_body_part`, `injury_notes`
  (e.g. "Surgery") and `news_updated`. They are kept in `LIVE.inj` (by app id
  and `"sl:" + Sleeper id`, cached) and read with `injuryOf(p)`. Anyone not
  healthy is tagged by his name in the matchup lineups and bench (Q, D, O,
  IR, PUP, SUS, DNR, NA; amber, orange, red, grey) and his player card says
  what it is and when Sleeper's news on him last changed. The live week's
  projections are fetched again every hour so the report stays current
  through the week and on game day. Practice participation is not filled in
  by Sleeper. `node tools/injury-check.mjs` runs it on Sleeper's real report.
- **Win %**: remaining projection is scaled by how much of each game is left
  (ESPN period and clock). `winProbability` spreads the outcome by
  2.2 x the square root of the points still projected, measured on real
  week 1-3 lineups (a lineup's score landed about that far from its
  projection), and stays between 1% and 99% until the last game is over.
  Sleeper does not publish its own win percentages (not in its public API),
  so these are the app's.
- **PROJ** (`teamProj`): ahead of a week, the lineup's projection. While
  the week is played, the points so far plus what is still to come (the
  same remaining projection the odds use), so a team whose whole lineup has
  played is projected exactly what it scored. When the live week moves on
  (four hours after Monday night's kickoff, early Tuesday) the finished week
  shows what each lineup was projected before any game was played: the
  starters Sleeper has for that week, priced with that week's projections,
  fetched when the week is opened (`lvEnsureWeek`). A week ahead takes its
  odds from the projections (`gameOdds`), as it will when it goes live.
  `node tools/proj-check.mjs` checks Thursday, Sunday, Monday and Tuesday.
- **League median** (League tab, over the week's games, under the week
  stepper): the middle of all the teams' scores that week (the average of
  the two middle ones for an even count), and beside it, smaller, the
  projected league median: the middle of the teams' PROJ (`teamProj`), so
  it moves through the week the same way and shows the pregame figure for a
  finished week. Before a week kicks off only the projected one has a value.
  Once a week is over (every game final), each team's two results show by
  its score, in the same places on every card: a green check if it won its
  game, a gold arrow if it scored above the league median (either, both or
  neither), with a key on the median line. Not shown while the week is
  played. `node tools/median-check.mjs`.
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
  player's points (and anything negative) accrue, unmarked and steadily,
  through the part of his game played, so every chart still ends on his
  total. (They used to land in four lumps at the quarter breaks; against a
  projection that runs down minute by minute that drew a sawtooth of
  spikes, and a last lump right at the end.) The odds line runs straight
  between the moments that move a matchup (a kickoff, a scoring play and
  the minute before it, a game's end, a window's edges, now), and the cursor
  reads along it; worked out minute by minute in between it curled. For the
  live week the chart ends on the live score and the card's odds: at now
  while a game is on, at the last minute played between games (Monday
  morning it ends Sunday night, not on the clock). Game minutes only, a
  point for each (`SAMPLE_MIN`).
- **Every matchup has a chart**: All Matchups shows a win-chance strip on each
  card (above the midline the left team leads, below it the right, in team
  colours); tapping it opens that matchup with the full chart, and its lineup
  follows the chart's minute like your own. An imported league's finished weeks
  chart, and list, the starters each team actually used (Sleeper's record), so
  the lineup, the chart and the final agree. Scoring plays
  are fetched for every team's games, and a game's summary is re-fetched only
  when its score changes.
- **Teams follow trades.** The app's player list is from before the season,
  so a player's NFL team comes from Sleeper (`lvTeamOf`): each week's rows
  name the team he played for (stats) or is projected with (projections),
  and every row carries the team he is with now. Two rules cover every place
  a team is read:
  - **The list itself is kept current** (`lvApplyTeams`): each record is moved
    to the team the player is with now (or FA, unsigned), keeping the shipped
    team as `tm0`. So anything that reads a player straight from the list
    (search, Available, Leaders, the draft room and board, the trade builder
    and trade block, a league on show, Markets, which is built as the page
    loads and re-synced) has the current team. In the real fixture data 68
    players had changed teams and 166 were no longer signed.
  - **Anything worked out for a week uses that week's team** (`wkTeam`):
    roster entries as they are hydrated (game, kickoff, lock, bye), stat
    lines and the stats sheet, whether his game has started, how much of it
    is left (live odds, team outlook), touchdowns on the chart, which games'
    plays are fetched, a league's start-time rule, the card's weekly log and
    byes, season points. A traded player plays for his new team from his
    first game there; his earlier weeks stay with the old one.
  Matching Sleeper's rows to the list knows both teams and remembers a
  player once matched (`LIVE.sid`, with Sleeper's own NFL id as a last
  resort), so a traded player is still found if Sleeper spells him
  differently. A trade offer records the team he is with now; a trade
  graphic shows the team he was with when the trade was made. Teams are
  saved with the finished weeks. `node tools/team-move-check.mjs` moves
  Marvin Harrison Jr. to Houston and one of your starters, Nico Collins,
  to Miami (who had not kicked off) in the real week 4 data, and checks 21
  places.
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
- **Finished weeks correct themselves.** A week's Sleeper points and ESPN
  plays used to be fetched only while it was the live week, so opening the
  app mid-game and not again until the next week froze them there: the total,
  team scores and touchdowns stayed at that moment while the box score
  (fetched fresh) was final, and the stats sheet showed the gap as a large
  negative "Other scoring". Now each week's Sleeper points are marked final or
  not when saved and pulled again until they are final (`slWeeksDue`), and the
  six-hourly full sync takes last week again for stat corrections. ESPN plays
  are keyed on the game's score and state (`lvPlaysFresh`), so a game's are
  fetched once more when it goes final; a finished week's scoreboard saved
  with a game under way is fetched again (`lvBoardStale`); last week's box
  scores are fetched once a session. `node tools/stale-week-check.mjs` rolls
  week 3 back to a mid-game save and checks it comes back whole.

## Links, records and schedules

- **Player names** are links everywhere they appear (matchups, bench, swap
  sheet, stats sheet, draft board and pick sheets, recent picks, draft
  history, trade builder and trade cards, transactions, commissioner roster
  tools, drop confirmation): `plink()` marks them with `data-pc`, and one
  capture-phase click handler opens the player card before any action of the
  row underneath. Rows that select or swap keep doing so everywhere except on
  the name. A held draft tile (reactions) is not treated as a tap. The card's
  close button (top right of the card) returns to the same screen, scroll
  position and open sheet.
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

## The matchup screen

- **Swipe sideways** for the week's other games (`bindMatchupSwipe`,
  `showGameAt`): left for the next, right for the one before, wrapping round
  so both work from your own. The game shows on the same screen, scoreboard,
  chart and both lineups, read-only; only your own lineup can be edited. Dots
  in the scoreboard's top row say which game it is (yours is ringed) and tap
  straight to one. The Matchup tab, All Matchups' own card and a new week all
  go back to your game. A drag that starts on the chart scrubs the chart, a
  mostly vertical one scrolls, and one from the very edge of the screen is
  left to the browser's back gesture.
- **Every week but the live one** opens on the full matchup, both lineups
  with each player's stat line, instead of a "View Full Matchup" link. A past
  week's chart is that week's game (it used to chart this week's opponent).
- **The header folds away** as you scroll down and comes back as you scroll
  up. Folding makes the scroll area taller, which near the end of a short
  page pulls the scroll position back up; that used to read as a scroll up
  and unfold it, over and over (All Matchups shook on a phone). It now folds
  only when the page stays scrollable past where you are, ignores the moves
  the browser makes while the fold settles, and ignores the end of the page.
- **The win-probability chart zooms.** The time at its top left opens a menu
  (`rwMenuHTML`) of the week's kickoff slots, taken from the NFL schedule
  (`weekSlots`), each with the stretch it covers: a slot runs until
  the next one kicks off, so 12PM is noon to 3:05, and kickoffs within half
  an hour (3:05 and 3:25) are one slot. A slot is offered when one of the
  matchup's starters kicked off in it and it has been played. Two fingers (or
  ctrl + wheel) zoom to any stretch; the minutes under the fingers stay under
  them. Zoomed, the series is that stretch's minutes
  (`rewindSeries(sides, zoom)`), the next slot's kickoff at the right edge is
  left unmarked, the cursor goes to the end of the stretch, and a line under
  the chart gives each side's points over it and the odds either end. The
  scale is time (`rwScale`; gaps between game windows count as ten minutes),
  for the full chart and All Matchups' strips too. `node tools/chart-zoom-check.mjs`
  checks it against the whole-week series, minute for minute, with real
  pinches.
- `node tools/matchup-swipe-check.mjs` drives real touch events on City Boys
  and the imported league, and flicks All Matchups at three screen heights.

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
What is yours to style stays as you set it: your team's name and logo (and its
colours and font) and an uploaded league logo outlast every sync, with
Sleeper's team picture, team name and league picture as the fallback. Syncs
used to write Sleeper's back over them. `node tools/logo-check.mjs` sets all
three in the imported league, syncs, reloads and checks they hold, and checks
the notification count sits on the matchup screen's bell (it used to show in
the header's top right corner).

Sleeper ids map to the app's players through `SLEEPER_PLAYERS` (built from
Sleeper's full player list, `tools/fixtures/sleeper_players.json`), then by name
and position. Rookies missing from the app's player pool still show with their
name and Sleeper points. `node tools/sleeper-check.mjs` imports the real City
Boys Dynasty league from `tools/fixtures/league/`.
`node tools/stat-check.mjs` checks the stat lines and the stats sheet against
the same league and Sleeper's week 3 and 4 numbers.
