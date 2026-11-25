# Trade Desk

Dynasty player values for City Boys Dynasty, the way KeepTradeCut prices them, except
**every team gets its own number**. The desk learns each manager's prices from the trades
they make and the offers they turn down, so the next offer you send is priced in their eyes,
not the market's.

A standalone React + TypeScript app, built by esbuild into one claude.ai artifact
(`dist/artifact.html`). It shares no code with the rest of this repository.

```
cd trade-desk
npm install
npm run build        # dist/artifact.html
npm test             # model, learning, trade search, KTC paste, StatsDeck import, history
npm run typecheck
node tools/ui-check.mjs <seed.json> [payloads.json] [shotsDir]   # drives the built page in Chromium
```

## Where the data comes from

- **Rosters, records, picks and league trades** come from Sleeper through the **StatsDeck**
  connector (`get_standings`, `get_my_roster`, `get_league_team`, `get_trades`). The page calls
  it as the viewer, so **Sync** works for anyone with StatsDeck connected to this league.
  The artifact can't fetch Sleeper directly: claude.ai pages can only reach the network through
  connectors.
- **Game logs** (`get_player_stats`) rebuild a player's value week by week from before the desk
  was tracking him.
- **Market values** default to the desk's production model. Paste KeepTradeCut's rankings on
  the Data tab to price off KTC instead.
- **Everything you do** (offers you log, manager notes, nudges, value history) is saved in the
  artifact's database. The access rules give read and write to the owner and editors only, so
  leaguemates you share a view link with see nothing.

Database layout: `league/current` (the League), `league/settings` (traits, nudges, KTC
overrides, your two rankings in `mine` and `consensus`), `trades/<id>` (one TradeLog each), `history/<YYYY-MM-DD>` (one Snapshot per sync
day: market plus all ten teams' values), `rebuilt/<player id>` (values rebuilt from game logs), `rankings/<YYYY-MM-DD>` (one week's
rankings: what you set, plus the frozen board). Before weekly rankings existed, edits lived in
`league/settings` (`mine`, `consensus`); those carry into the first week as its starting list.

`tools/seed.ts` turns saved StatsDeck payloads into those documents, for seeding a new copy of
the artifact or for the UI check. The payloads are real league data, so they aren't committed.

## The model (`src/core`)

**Market value** (`model.ts`), 0–10,000: points per game above a replacement starter in a
10-team superflex league (QB 14, RB/WR 7.5, TE 5.5), times the seasons a player has left at his
age and position (five years, discounted, with growth for players under 25). Points per game
blend StatsDeck's recency-weighted form with the longer-run rate backed out of its trajectory,
half and half, so the market believes half of a hot streak. Picks price by round, by projected
slot from the original owner's standing, and by how far out they are.

**Each team's value** multiplies market by:

| factor | what moves it |
|---|---|
| hype | how much the manager chases streaks; an owner believes his own guy's streak and shrugs off his slump |
| need | how thin the team is at the position (vs league average), and whether the player would start there |
| window | contenders pay up to ~10% more for veterans, rebuilders for youth and picks |
| endowment | managers value their own players 8% higher (you don't: your numbers stay honest) |
| learned | per-team, per-player and per-position adjustments fitted to the trade log |
| nudge | anything you set by hand on a player sheet |

**Packages** add on a 1.3-power curve, so the best player in a deal counts for more than the
depth around him. **Chance of a yes** is a logistic on (what they get − what they give − a
3% margin), scaled to the size of the trade.

**Learning** (`trade.ts`, `fitLearned`) is a regularized logistic regression refitted from the
whole log every time it changes. A rejection raises what they kept and lowers what you offered,
in that team's eyes only, by enough to explain the no. A yes does the opposite. A completed
league trade teaches both teams. Answers lose half their weight every 60 days (hype fades), one
answer moves a value by roughly 15–20% at most, and deleting a log entry deletes its lesson. A
rejection of an offer the desk already rated a long shot teaches almost nothing; a no to a deal
it rated close teaches the most.

## Screens

- **My team**: positional strength vs the league, sell-high spots (teams that value your players
  above what they're worth to you), and your roster with market value, value to you and top buyer.
- **Trade lab**: build a deal with any team. Shows the chance they accept, both sides' views, why
  each piece is priced as it is, the cheapest add that gets a no to a yes, and buttons to log the
  answer.
- **Find a trade**: pick a target; the desk searches your roster for packages his owner would
  likely take, cheapest for you first.
- **Rankings**: two editable boards. *Your values* is what each player is worth to you; it
  replaces the desk's read for your side of every trade. *League values* is what you think the
  league in general pays; every team starts from it before its own lean is applied. Type a value,
  type a rank (the desk picks a value between the new neighbours), or use the arrows; ↺ resets
  one, *Reset all* resets the board. Both numbers are also editable on every player sheet.
  Precedence for market value: your league value, then a KTC paste, then the model.
  **Rankings are kept per NFL week** (Tuesday to Monday). Edits go into this week's record; a
  new week starts from the latest earlier week's list, so you only change what moved. Every edit
  and every sync freezes the full board (both lists, every asset, with names so cut players
  survive) into `rankings/<week's Tuesday>`. *Look back* shows any saved week read-only, with
  each player's value then and now, rank moves since (counted only among players on both lists),
  and the biggest risers and fallers. Each player sheet lists his values week by week.
- **League**: every team's window, positional strength and what their trades have shown. A team's
  board lists who they overrate and underrate, and holds the manager's name and tendencies.
- **Log**: every offer and league trade the desk learns from.
- **Data**: sync, KTC paste, and how the numbers work.
