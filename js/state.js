// Runtime state shared across modules.
//
// Everything here is rebound from a module other than the one that used to declare
// it. An ES module's imported bindings are read-only, so these cannot be exported
// as plain `let`s - they live as properties on one object instead.
export const S = {
  week: 1,
  games: [],
  lineupSlots: null,        // filled in by store.js at load, from buildSlots()
  teamBackView: 'matchup',
  currentPlayerName: null,
  pidx: null,               // player index cache; null means "rebuild on next read"
  trendPos: 'ALL',
  leaderWeek: 1,            // was initialised to WEEK, which is 1 at that point
  leaderScope: 'season',
};
