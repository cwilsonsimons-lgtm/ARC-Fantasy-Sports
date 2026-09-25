# Live stats: handoff

Goal: replace every made-up number in `1stPrototype.html` with real 2026 NFL
data, live during games. Blocked in the session that wrote this only because its
network policy denied `api.sleeper.app`, `api.sleeper.com` and `site.api.espn.com`;
the owner has since allowed them, which takes effect in a new session.

**First step in the new session:** confirm the hosts answer, then build against
real responses. Do not guess response shapes.

```
curl -sS https://api.sleeper.app/v1/state/nfl
curl -sS https://api.sleeper.app/v1/stats/nfl/regular/2026/1 | head -c 2000
curl -sS https://api.sleeper.app/v1/projections/nfl/regular/2026/3 | head -c 2000
curl -sS https://api.sleeper.app/v1/players/nfl | head -c 2000   # large; check gsis_id
curl -sI https://api.sleeper.app/v1/state/nfl | grep -i access-control   # CORS for the browser
```

## What is fake today (all in `1stPrototype.html`)

| Thing | Where | How it is faked |
|---|---|---|
| Current week | `var LIVE_WEEK = 1` | hard-coded; the real 2026 schedule with dates is already in `NFL_SCHED_SRC` (week 3 = Sep 24–28) |
| Player points in lineups | `pLive(proj, name)` | hash of the name × projection |
| Player stat lines | `statLineFor(p, week)` | invented from a hash; scored by the real engine `scoreStats(stats, {pos})` with the league's own scoring |
| Team scores, other weeks | `seededScore(week, key)` | hash of team key + week |
| Projections | `proj` on each player in `NFL_PLAYERS` | static numbers |
| Rewind scoring times | `jumpsFor(name)` / `touchdowns()` in js/rewind.js | points land at hashed moments in each game |
| Live clock | `simIdx` / `simKick()` | now fixed at "week final" since the stepper was removed |

Player ids in the app are NFL GSIS ids (`"00-0039075"`, see `NFL_BY_ID`).

## Plan

1. **Current week from the schedule dates** (`NFL_SCHED_SRC`): the live week is
   the one whose TNF–MNF window contains now (or the next one before it starts).
   Past weeks are final, future weeks projection-only. `LIVE_WEEK` becomes that.
2. **Real stat lines**: fetch Sleeper weekly stats (one request per week, keyed
   by Sleeper player id), map to GSIS via the players dump (`gsis_id`, trim it),
   translate keys into the app's stat keys (`pass_yd→passYd`, `pass_td→passTD`,
   `pass_int→passInt`, `pass_cmp→passComp`, `pass_att→passAtt`, `rush_yd→rushYd`,
   `rush_att→rushAtt`, `rush_td→rushTD`, `rec→rec`, `rec_yd→recYd`, `rec_td→recTD`,
   `fum→fum`, `fum_lost→fumLost`, first downs, sacks; bonuses derived the way
   `statLineFor` does). Then `statLineFor` returns the real line when one exists,
   and lineup points (`pLive`) come from `scoreStats(realLine)`, so every league's
   scoring settings apply. Cache per week (past weeks in localStorage; the
   players map is big, so store only the gsis→sleeper id map, or build that map
   once via a GitHub Action into a small JSON file in the repo).
3. **Live week**: re-fetch the live week every ~60s while a game in it is in
   progress (kickoff ≤ now ≤ kickoff + ~3.5h), and re-render the matchup;
   `isLocked()` should follow real kickoffs rather than `simIdx`.
4. **Team scores / matchups / standings** from summed real starter points;
   leagues drafted after weeks 1–2 show what the current lineup would have scored.
5. **Projections** from Sleeper projections for the week, replacing static `proj`.
6. **Rewind** (optional, needs ESPN): use real scoring-play times from ESPN game
   summaries instead of `jumpsFor`; otherwise keep the estimated shape.

## Testing

Playwright against the real endpoints for shape, plus a stubbed route for a
"game in progress" to exercise the live refresh. Check City Boys and a created
league (see the league-context notes in the `js/league-context.js` block).
Serve over http, not file://, when checking CORS.
