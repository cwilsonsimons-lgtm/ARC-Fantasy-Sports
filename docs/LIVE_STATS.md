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
