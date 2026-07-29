import { store } from '../store.js';

// ---------- LEAGUE SETTINGS ----------
export const LEAGUE_DEFAULTS={
  type:'dynasty',        // redraft | keeper | dynasty
  teams:10,
  lineup:'classic',      // classic | bestball
  waiver:'rolling',      // rolling | reverse | faab
  faabBudget:100,
  faabMin:0,
  waiverDay:3,           // 0 Sun … 6 Sat  (3 = Wednesday)
  waiverHour:2,          // 24h clock, league time (2 = 2 AM)
  waiverPeriod:2,        // days a dropped player sits on waivers (0 = none)
  tradeDeadline:11,      // week number, 0 = no deadline
  commish:'pandas'       // team key that owns the commissioner role
};

export function LG(){return store.league;}

// ---------- SCORING ----------
export const SCORING_DEFAULTS={
  passYd:0.04, passTD:4, passInt:-2, pass2pt:2, passComp:0,
  rushYd:0.1, rushTD:6, rushAtt:0, rush2pt:2,
  rec:1, recYd:0.1, recTD:6, rec2pt:2,
  fumLost:-2, fumTD:6, krTD:6, prTD:6
};

export function SC(){return store.scoring;}
// Ran at top level in the original single-file script. main.js calls it
// during boot so it keeps its original position in the startup order.
export function initLeagueConfig(){
store.league=Object.assign({},LEAGUE_DEFAULTS,store.league||{});
store.scoring=Object.assign({},SCORING_DEFAULTS,store.scoring||{});
}
