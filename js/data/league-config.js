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
  commish:'pandas',      // team key that owns the commissioner role
  // ---- draft ----
  draftDate:'2026-08-27',  // yyyy-mm-dd the draft opens
  draftTime:'19:00',       // 24h HH:MM the draft opens (league time)
  draftType:'snake',       // snake | linear | auction
  draftPool:'all',         // all | rookies | vets — who is eligible to be drafted
  draftPickSec:90,         // seconds on the clock per pick
  draftPauseHour:0,        // 24h hour the draft pauses each night (slow drafts only)
  draftResumeHour:8,       // 24h hour the draft resumes the next morning
  draftRounds:15,          // rounds in the draft
  draftOrder:null          // array of team keys; null = fall back to the league's default order
};

// ---------- MULTI-LEAGUE ----------
// City Boys Dynasty is the playable league and keeps living at
// store.league / store.scoring / store.slots. Leagues created in-app are full
// settings objects (league + scoring + slots) with no season data behind them
// yet; while one of them is "current", LG()/SC()/SLOTS() serve its objects so
// the whole Settings page just works against the new league.
export function allLeagues(){return store.leagues=store.leagues||[];}
export function findLeague(id){return allLeagues().find(l=>l.id===id)||null;}
export function curLeague(){return store.curLeagueId?findLeague(store.curLeagueId):null;}
export function curLeagueName(){const c=curLeague();return c?c.name:'City Boys Dynasty';}

export function LG(){const c=curLeague();return c?c.league:store.league;}

// ---------- SCORING ----------
export const SCORING_DEFAULTS={
  passYd:0.04, passTD:4, passInt:-2, pass2pt:2, passComp:0,
  rushYd:0.1, rushTD:6, rushAtt:0, rush2pt:2,
  rec:1, recYd:0.1, recTD:6, rec2pt:2,
  fumLost:-2, fumTD:6, krTD:6, prTD:6
};

export function SC(){const c=curLeague();return c?c.scoring:store.scoring;}
// Ran at top level in the original single-file script. main.js calls it
// during boot so it keeps its original position in the startup order.
export function initLeagueConfig(){
store.league=Object.assign({},LEAGUE_DEFAULTS,store.league||{});
store.scoring=Object.assign({},SCORING_DEFAULTS,store.scoring||{});
// created leagues pick up any settings added since they were made
allLeagues().forEach(l=>{
  l.league=Object.assign({},LEAGUE_DEFAULTS,l.league||{});
  l.scoring=Object.assign({},SCORING_DEFAULTS,l.scoring||{});
});
}
