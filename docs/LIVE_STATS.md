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
progress). `node tools/live-check.mjs` runs the app against them.

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
  are cached in `localStorage` (`arc_live_v1`).
- **Win %**: remaining projection is scaled by how much of each game is left
  (ESPN period and clock).
- **Rewind**: each touchdown a starter is named in lands at its real game time;
  the rest of their points accrue through the part of the game played. For the
  live week the chart ends at now, on the live score.

## Known gaps

- Team records (W-L) are still the stored `rec` values; points for and against
  come from real scores, but wins and losses are not yet computed from them.
- Kickers and defenses are not on rosters, so their stats are not mapped.
- A handful of players whose names differ between sources may not match
  (about 3% of scorers in week 3).

## Sleeper league import

Home ▸ **Import from Sleeper** takes a league ID, lists its teams, and asks
which one is yours. The league becomes a created league (`js/sleeper.js`)
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
