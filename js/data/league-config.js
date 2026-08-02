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
// Every league is its own isolated world. The only data shared across leagues
// is global app data: the NFL player pool and "you", the user.
//
// City Boys Dynasty is the original seeded league; its data keeps living where
// it always has (store.league / scoring / slots / draft / roster / backdrops /
// players / team, plus the hardcoded demo teams and schedule). A league
// created in-app owns a full record in store.leagues with its own teams,
// draft, rosters, photos and settings, all starting empty.
//
// The accessors below are the app's WHERE leagueId = activeLeagueId. Nothing
// league-scoped reads store fields directly - it goes through these, which
// route to the current league's collections. Switching leagues is therefore a
// data-layer swap, not a UI trick.
export function allLeagues(){return store.leagues=store.leagues||[];}
export function findLeague(id){return allLeagues().find(l=>l.id===id)||null;}
export function curLeague(){return store.curLeagueId?findLeague(store.curLeagueId):null;}
export function curLeagueName(){const c=curLeague();return c?c.name:'City Boys Dynasty';}

// draft (picks + commissioner draft config)
export function DRAFT(){
  const c=curLeague();
  if(c)return c.draft=c.draft||{picks:[]};
  return store.draft=store.draft||{picks:[]};
}
// per-league player customizations (photos, nicknames)
export function PLAYERS(){
  const c=curLeague();
  if(c)return c.players=c.players||{};
  return store.players=store.players||{};
}
// your persisted roster in the active league
export function getRoster(){const c=curLeague();return c?c.roster:store.roster;}
export function setRoster(r){const c=curLeague();if(c)c.roster=r;else store.roster=r;}
// matchup photos (per-game and league-wide backgrounds)
export function BACKDROPS(){
  const c=curLeague();
  if(c)return c.backdrops=c.backdrops||{};
  return store.backdrops=store.backdrops||{};
}
export function getGlobalBackdrop(){const c=curLeague();return c?c.globalBackdrop:store.globalBackdrop;}
export function setGlobalBackdrop(url){
  const c=curLeague();
  if(c){c.globalBackdrop=url||null;c.backdrops={};}
  else{if(url)store.globalBackdrop=url;else delete store.globalBackdrop;store.backdrops={};}
}

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
