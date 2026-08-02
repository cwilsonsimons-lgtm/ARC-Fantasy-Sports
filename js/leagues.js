import { S } from './state.js';
import { winProbability } from './clock.js';
import { MY_TEAM, T } from './data/teams.js';
import { draftDone } from './draft.js';
import { LIVE_WEEK } from './lineup.js';
import { homeTab, showTab, showView, toggleDrawer } from './nav.js';
import { saveStore, store } from './store.js';
import { renderWeek } from './week.js';

// ======================= LEAGUES =======================
// The app used to open inside one hard-coded league. Everything above league
// scope now lives here: the hub's list, which league is active, and the seam
// (`openLeague`) that enters one.
//
// City Boys Dynasty is the real league — its teams are `T`, its roster is the
// live LINEUP, its draft is the draft room. The other three are seeded data
// only: they render their own matchup, standings and rosters and nothing in
// them writes back. `real:true` is the flag that separates the two.

export const LG_STATUS={active:'active',predraft:'predraft',complete:'complete'};

// Deterministic per-league colour/score seeding, same FNV-1a the rest of the
// app uses so a hub row never moves between reloads.
function seed(s){let h=2166136261;s=String(s);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0);}
function mkTeams(id,rows){
  const out={};
  rows.forEach((r,i)=>{
    const [key,n,mgr,rec,c,bg]=r;
    out[key]={n,mgr,rec,rk:i+1,c,bg,mono:n.replace(/[^A-Za-z]/g,'').charAt(0).toUpperCase()||'?',font:'oswald'};
  });
  return out;
}

const SUNDAY_TEAMS=mkTeams('sunday',[
  ['audible','Silent Audible','Priya','7-1','#5AE6B5','#123329'],
  ['rondo','Rondo Numba Nine','Devin','6-2','#329F5B','#16281C'],
  ['pylon','Pylon Pushers','Marcus','5-3','#5AA9E6','#132a3d'],
  ['gasso','Gasso Line','Tati','5-3','#C77DFF','#26163d'],
  ['screen','Screen Pass Society','Owen','4-4','#F05D5E','#33110f'],
  ['tuddy','Tuddy Water','Reggie','4-4','#329F5B','#1c3312'],
  ['pocket','Collapsed Pocket','Nadia','3-5','#E65A7A','#3d1622'],
  ['motion','Pre-Snap Motion','Ben','3-5','#7D9BFF','#151f3d'],
  ['icing','Icing The Kicker','Sol','2-6','#E6D15A','#3a3512'],
  ['chunk','Chunk Yardage','Wes','2-6','#4EC9A5','#0f3329'],
  ['gunner','Gunner Culture','Ade','2-6','#FF9E5A','#3d2412'],
  ['flea','Flea Flicker Co','Junie','1-7','#B0BCC9','#242c33'],
]);
const MIDWAY_TEAMS=mkTeams('midway',[
  ['ledger','The Ledger','Wilson','0-0','#329F5B','#1c3312'],
  ['compound','Compound Interest','Hana','0-0','#5AA9E6','#132a3d'],
  ['tenure','Tenure Track','Diego','0-0','#E6A85A','#33270f'],
  ['vesting','Fully Vested','Kai','0-0','#C77DFF','#26163d'],
  ['arb','Arbitrage','Nolan','0-0','#5AE6B5','#123329'],
  ['escrow','Escrow Boys','Maya','0-0','#F05D5E','#33110f'],
  ['annuity','Annuity Ave','Trip','0-0','#E65A7A','#3d1622'],
  ['prospect','Prospect Theory','Ivy','0-0','#7D9BFF','#151f3d'],
  ['carry','Carried Interest','Sam','0-0','#E6D15A','#3a3512'],
  ['tranche','Tranche Warfare','Obi','0-0','#4EC9A5','#0f3329'],
]);
const HALLMARK_TEAMS=mkTeams('hallmark',[
  ['garland','Garland Party','Wilson','11-3','#329F5B','#1c3312'],
  ['mistletoe','Mistletoe Militia','Erin','10-4','#F05D5E','#33110f'],
  ['tinsel','Tinsel Town','Gus','9-5','#E6D15A','#3a3512'],
  ['sleigh','Sleigh All Day','Rosa','8-6','#5AA9E6','#132a3d'],
  ['nutmeg','Nutmeg Nation','Pete','6-8','#E6A85A','#33270f'],
  ['yule','Yule Be Sorry','Lena','5-9','#C77DFF','#26163d'],
  ['carol','Carol Singers','Dmitri','4-10','#5AE6B5','#123329'],
  ['figgy','Figgy Pudding FC','Bea','3-11','#E65A7A','#3d1622'],
]);

export const LEAGUES=[
  {id:'cbd',name:'City Boys Dynasty',logo:null,type:'dynasty',teamCount:10,week:null,
   status:null,myTeamKey:MY_TEAM,real:true},
  {id:'sunday',name:'Sunday Best',logo:null,type:'redraft',teamCount:12,week:9,
   status:'active',myTeamKey:'rondo',teams:SUNDAY_TEAMS,opp:'pylon',real:false},
  {id:'midway',name:'Midway Holdings',logo:null,type:'dynasty',teamCount:10,week:1,
   status:'predraft',myTeamKey:'ledger',teams:MIDWAY_TEAMS,opp:'compound',real:false,
   draftInDays:6,draftHour:20},
  {id:'hallmark',name:'Hallmark Dynasty',logo:null,type:'redraft',teamCount:8,week:17,
   status:'complete',myTeamKey:'garland',teams:HALLMARK_TEAMS,opp:'mistletoe',real:false,
   placed:1},
];
export const LEAGUE_BY_ID={};LEAGUES.forEach(l=>LEAGUE_BY_ID[l.id]=l);

// ---- leagues the user made here ----
// The four above are seed data. Anything the create wizard produces lands in
// `store.myLeagues` and is lifted into the same shape, so the hub, the ordering
// and `openLeague` do not care which kind they are holding.
export function myLeagues(){
  if(!store.myLeagues)store.myLeagues=[];
  return store.myLeagues;
}
function asLeague(rec){
  return {id:rec.id,name:rec.name,logo:null,type:rec.league.type,
          teamCount:+rec.league.teams,week:1,status:'forming',
          myTeamKey:null,real:false,created:true,rec};
}
export function allLeagues(){return LEAGUES.concat(myLeagues().map(asLeague));}
export function leagueById(id){
  if(LEAGUE_BY_ID[id])return LEAGUE_BY_ID[id];
  const mine=myLeagues().find(l=>l.id===id);
  return mine?asLeague(mine):LEAGUES[0];
}
export function activeLeagueId(){return store.activeLeague||'cbd';}
export function activeLeague(){return leagueById(activeLeagueId());}
export function inRealLeague(){return !!activeLeague().real;}

/** City Boys Dynasty has no fixed status — it is whatever the draft says it is. */
export function leagueStatus(lg){
  if(lg.created)return 'forming';   // waiting on managers, not on a clock
  if(!lg.real)return lg.status;
  return draftDone()?'active':'predraft';
}
export function leagueWeek(lg){return lg.real?S.week:lg.week;}
export function teamsOf(lg){return lg.real?T:lg.teams;}
export function myKeyOf(lg){return lg.myTeamKey;}
/** The crest `markInner` draws for a league: an uploaded logo, else its own mark. */
export function leagueMark(lg){
  const up=(store.leagueLogos||{})[lg.id];
  return {logo:up||lg.logo||null,mono:lg.name.charAt(0).toUpperCase()};
}
export function leagueTint(lg){
  const t=teamsOf(lg);const me=t&&t[myKeyOf(lg)];
  return me?me.c:'var(--accent)';
}

// ---- the user's matchup inside a league ----
// The real league reads the live scoreboard; a seeded league carries its own.
export function leagueScore(lg){
  const teams=teamsOf(lg),me=myKeyOf(lg),opp=lg.opp;
  if(lg.real){
    const g=(S.games||[]).find(x=>x.me);
    if(!g)return null;
    const mine=g.a===MY_TEAM,oppKey=mine?g.x:g.a;
    return {me:MY_TEAM,opp:oppKey,ms:mine?g.as:g.xs,os:mine?g.xs:g.as,
            mw:mine?g.aw:g.xw,teams:T};
  }
  if(!teams||!opp)return null;
  const ms=Math.round((60+seed(lg.id+me+lg.week)%800/10)*10)/10;
  const os=Math.round((60+seed(lg.id+opp+lg.week)%800/10)*10)/10;
  const rem=leagueStatus(lg)==='complete'?0:Math.max(0,180-(ms+os)/2);
  return {me,opp,ms,os,mw:winProbability(ms-os,rem),teams};
}
/** Pre-draft leagues show a countdown, so they need a clock instead of a score.
 *  Anchored once, in the store, so it counts down rather than resetting. */
export function draftAt(lg){
  if(!store.draftAt)store.draftAt={};
  if(!store.draftAt[lg.id]){
    const d=new Date();
    d.setDate(d.getDate()+(lg.draftInDays||5));
    d.setHours(lg.draftHour||19,0,0,0);
    store.draftAt[lg.id]=d.getTime();
    saveStore();
  }
  return store.draftAt[lg.id];
}
export function countdownParts(ms){
  const s=Math.max(0,Math.floor(ms/1000));
  return {d:Math.floor(s/86400),h:Math.floor(s%86400/3600),m:Math.floor(s%3600/60)};
}

// ---- hub ordering ----
export function orderedLeagues(){
  const all=allLeagues(),byId={};all.forEach(l=>byId[l.id]=l);
  const saved=store.leagueOrder||[];
  const seen=new Set(),out=[];
  saved.forEach(id=>{const l=byId[id];if(l&&!seen.has(id)){seen.add(id);out.push(l);}});
  all.forEach(l=>{if(!seen.has(l.id))out.push(l);});
  return out;
}
export function setLeagueOrder(ids){store.leagueOrder=ids.slice();saveStore();}

// ---- entering / leaving a league ----
export function openLeague(id){
  const lg=leagueById(id);
  store.activeLeague=lg.id;saveStore();
  document.body.classList.remove('hub');
  document.body.classList.toggle('seeded',!lg.real);
  stampLeagueBar(lg);
  if(lg.created){
    if(window.renderWaitRoom)window.renderWaitRoom(lg.id);
    if(document.body.classList.contains('open'))toggleDrawer();
    return;
  }
  if(lg.real){
    // Repaint from the real league's own state first: a seeded league leaves
    // its markup in the shared matchup containers, and `showTab` only
    // re-renders team and draft. `S.week` is never touched by a seeded league,
    // so this restores City Boys Dynasty exactly as it was left.
    renderWeek();
    showTab(homeTab());
  }else{
    showSeededLeague(lg);
  }
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function goHome(){
  document.body.classList.remove('seeded');
  showView('home');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  const sc=document.getElementById('scroll');if(sc)sc.scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
  renderHomeHook();
}
// renderHome lives in home.js; leagues.js is imported first, so go through window.
function renderHomeHook(){if(typeof window!=='undefined'&&window.renderHome)window.renderHome();}
function showSeededLeague(lg){if(typeof window!=='undefined'&&window.renderSeededLeague)window.renderSeededLeague(lg);}

/** The league bar names whichever league is open. */
export function stampLeagueBar(lg){
  const nm=document.querySelector('.league-id .nm');
  const wk=document.querySelector('.league-id .wk');
  if(nm)nm.childNodes[0].nodeValue=lg.name+' ';
  const st=leagueStatus(lg);
  if(wk)wk.textContent=st==='forming'?'FORMING'
    :st==='predraft'?'PRE-DRAFT'
    :st==='complete'?'FINAL':'WEEK '+leagueWeek(lg);
}

export function initLeagues(){
  store.activeLeague=store.activeLeague||'cbd';
  store.leagueOrder=store.leagueOrder||LEAGUES.map(l=>l.id);
  store.leagueLogos=store.leagueLogos||{};
}
