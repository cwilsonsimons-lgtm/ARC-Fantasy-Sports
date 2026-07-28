// Primary team colours, used for the accent bar on market and holding rows.
export const TEAM_COLOR = {
  ARI:'#97233F', ATL:'#A71930', BAL:'#241773', BUF:'#00338D', CAR:'#0085CA',
  CHI:'#E64100', CIN:'#FB4F14', CLE:'#FF3C00', DAL:'#869397', DEN:'#FA4616',
  DET:'#0076B6', GB:'#FFB612',  HOU:'#A71930', IND:'#005A8B', JAX:'#00839C',
  KC:'#E31837',  LA:'#FFD100',  LAC:'#0080C6', LV:'#A5ACAF',  MIA:'#008E97',
  MIN:'#4F2683', NE:'#B0B7BC',  NO:'#D3BC8D',  NYG:'#0B2265', NYJ:'#125740',
  PHI:'#004C54', PIT:'#FFB612', SEA:'#69BE28', SF:'#AA0000',  TB:'#D50A0A',
  TEN:'#4B92DB', WAS:'#5A1414',
};

export function teamColor(tm) {
  return TEAM_COLOR[tm] || '#5E6B7C';
}
