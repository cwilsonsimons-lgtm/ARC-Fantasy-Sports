import { ORD_LABEL } from './data/nfl-index.js';
import { NFL_PLAYERS } from './data/nfl-players.js';
import { BENCH, LINEUP, TAXI, store } from './store.js';

// ===== SIMULATED WEEK CLOCK (pregame → per-kickoff locking → final) =====
// store.simIdx: -1 = pregame (nothing locked), 0..N-1 = at that kickoff, N = final.

export const SLOT_ELIG={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],WRT:['RB','WR','TE'],FLEX:['RB','WR','TE'],
  SFLX:['QB','RB','WR','TE'],K:['K'],DEF:['DEF']};
export function slotAllows(slot,pos){const e=SLOT_ELIG[slot];return e?e.indexOf(pos)>-1:true;}
export const ICON_LOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
export const ICON_SWAP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg>';
// parse a game string like "Sun 12:00 vs TB" into a sortable kickoff ordinal (Infinity = bye/FA/no game)
export function kickoffOrd(g){
  if(!g)return Infinity;
  const m=g.match(/(Thu|Fri|Sat|Sun|Mon|Tue|Wed)\s+(\d{1,2}):(\d{2})/);
  if(!m)return Infinity;
  const day={Thu:1,Fri:2,Sat:3,Sun:4,Mon:5,Tue:6,Wed:7}[m[1]]||4;
  let hr=+m[2];const min=+m[3];
  if(hr!==12)hr+=12;  // NFL kickoff windows are PM; noon stays 12 (no AM games in this data)
  return day*2000+hr*60+min;
}
export function ordLabel(ord){
  if(ord<0)return 'PREGAME';
  if(!isFinite(ord))return 'FINAL';
  if(ORD_LABEL[ord])return ORD_LABEL[ord];
  const day=Math.floor(ord/2000),rest=ord%2000;let hr=Math.floor(rest/60);const min=rest%60;
  const dn={1:'THU',2:'FRI',3:'SAT',4:'SUN',5:'MON',6:'TUE',7:'WED'}[day]||'SUN';
  if(hr>12)hr-=12;
  return `${dn} ${hr}:${String(min).padStart(2,'0')}`;
}
// distinct kickoff times across the whole matchup, sorted — the stops the sim clock steps through
export function simStops(){
  const set=new Set();
  [LINEUP,BENCH,TAXI].forEach(arr=>arr.forEach(r=>['a','x'].forEach(s=>{
    const o=pOrd(r[s]);if(isFinite(o))set.add(o);
  })));
  return [...set].sort((p,q)=>p-q);
}
export function simKick(){
  const stops=simStops(),i=store.simIdx;
  if(i<0)return -1;
  if(i>=stops.length)return Infinity;
  return stops[i];
}
export function pOrd(p){return (p&&p.ord!=null)?p.ord:kickoffOrd(p&&p.g);}
export function isLocked(p){return !!(p&&pOrd(p)<=simKick());}
// mock live points derived from real projections (stable per player)
export function pLive(proj,name){let h=2166136261;for(let i=0;i<name.length;i++){h^=name.charCodeAt(i);h=Math.imul(h,16777619);}
  return Math.round(proj*(0.15+((h>>>0)%120)/100)*10)/10;}
export function onField(name){let h=5381;for(let i=0;i<name.length;i++)h=((h<<5)+h+name.charCodeAt(i))>>>0;return h%3===0?'off':'on';}
// live-week totals — recomputed from the CURRENT lineup + sim clock (started players count, others are 0)
export let LT={a:0,x:0,ap:0,xp:0,aw:50,xw:50};
/**
 * Win probability from an expected-points edge and the points still to come.
 *
 * `rem` is the uncertainty: while games are outstanding the edge is only a
 * guess, and the more that is left to play the less a lead means. As the last
 * game ends `rem` reaches zero and the result is simply known - which is why
 * this returns an exact 0 or 100 rather than clamping near the edges the way a
 * straight-line formula does.
 */
export function winProbability(edge, rem){
  if (rem <= 0.01) return edge > 0 ? 100 : edge < 0 ? 0 : 50;
  // a fantasy week's remaining points swing roughly 1.8*sqrt(rem) either way
  const sigma = 1.8 * Math.sqrt(rem) + 1;
  return Math.round(100 / (1 + Math.exp(-1.7 * (edge / sigma))));
}

export function recomputeLT(){
  let a=0,x=0,ap=0,xp=0,remA=0,remX=0;
  LINEUP.forEach(r=>{
    const alp=r.a?pLive(r.a.proj,r.a.n):0, xlp=r.x?pLive(r.x.proj,r.x.n):0;
    const aOn=r.a&&isLocked(r.a), xOn=r.x&&isLocked(r.x);
    a+=aOn?alp:0; x+=xOn?xlp:0;
    ap+=r.a?r.a.proj:0; xp+=r.x?r.x.proj:0;
    remA+=(r.a&&!aOn)?r.a.proj:0; remX+=(r.x&&!xOn)?r.x.proj:0;   // still to play
  });
  const rnd=v=>Math.round(v*10)/10;
  const aw=winProbability((a+remA)-(x+remX), remA+remX);
  LT={a:rnd(a),x:rnd(x),ap:rnd(ap),xp:rnd(xp),aw,xw:100-aw};
}
export const LEADERS = [
  ['J. Allen','QB · BUF',28.6],['A. St. Brown','WR · DET',21.4],['B. Robinson','RB · WAS',18.2],
  ['C. Lamb','WR · DAL',17.9],['J. Mixon','RB · HOU',16.7],['D. Swift','RB · CHI',14.3],
  ['T. Hill','WR · MIA',13.8],['G. Kittle','TE · SF',12.6],
];
export const TRENDING = [
  {rk:1,n:'Isaiah Davis',pos:'RB',tm:'NYJ',game:'Sun 12:00 · @ TEN',add:9900,rost:56.4,rookie:false},
  {rk:2,n:'Zavion Thomas',pos:'WR',tm:'CHI',game:'Sun 12:00 · @ CAR',add:6500,rost:67.0,rookie:true},
  {rk:3,n:'Treylon Burks',pos:'WR',tm:'WAS',game:'Sun 3:25 · @ PHI',add:4600,rost:35.3,rookie:false},
  {rk:4,n:'Malik Benson',pos:'WR',tm:'LV',game:'Sun 3:25 · vs MIA',add:4400,rost:26.8,rookie:true},
  {rk:5,n:'Caleb Douglas',pos:'WR',tm:'MIA',game:'Sun 3:25 · @ LV',add:3500,rost:70.5,rookie:true},
  {rk:6,n:'Jalen Nailor',pos:'WR',tm:'LV',game:'Sun 3:25 · vs MIA',add:3200,rost:88.4,rookie:false},
  {rk:7,n:'Seth McGowan',pos:'RB',tm:'IND',game:'Sun 12:00 · vs BAL',add:2800,rost:53.5,rookie:true},
  {rk:8,n:'Erick All',pos:'TE',tm:'CIN',game:'Sun 12:00 · vs TB',add:2500,rost:24.3,rookie:false},
];
// leaders/free-agent pool = every active QB/RB/WR/TE in the league
export const POOL = NFL_PLAYERS;
// draft shape — declared here (not down in the DRAFT section) so draftDone()/preDraft()
// are safe to call from any render, including the first panel paint
export const DRAFT_ROUNDS=15;
export const DRAFT_ORDER=['barzal','saquon','pandas','boutte','doghouse','radiator','burrow','longhorns','brady','dakyard'];
export const ROSTER_CAP={QB:3,RB:6,WR:7,TE:3};
export const STARTER_NEED={QB:1,RB:2,WR:3,TE:1};
export const DRAFT_TOTAL=DRAFT_ROUNDS*DRAFT_ORDER.length;
export const RAIL = [
  {k:'hub',lb:'Leagues',action:'goHome()',ic:'<path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>'},
  {k:'chat',lb:'Chat',action:'openChat()',ic:'<path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.5 8.5 0 1 1 21 11.5Z"/>'},
  {k:'trending',lb:'Trending',ic:'<path d="M3 17 9 11l4 4 8-8"/><path d="M17 7h4v4"/>'},
  {k:'available',lb:'Available',ic:'<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M18 8v6M21 11h-6"/>'},
  {k:'leaders',lb:'Leaders',ic:'<circle cx="12" cy="9" r="5"/><path d="m8.5 13-1.5 8 5-3 5 3-1.5-8"/>'},
  {k:'draft',lb:'Draft',action:'openDraft()',ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>'},
  {k:'trades',lb:'Trades',action:'openChat()',ic:'<path d="M7 8h13l-3-3M17 16H4l3 3"/>'},
  {k:'scores',lb:'Scores',ic:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14"/>'},
  {k:'news',lb:'News',ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h7M7 12h10M7 16h6"/>'},
  {k:'settings',lb:'Settings',action:'openSettings()',ic:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>'},
];

// Ran at top level in the original single-file script. main.js calls it
// during boot so it keeps its original position in the startup order.
export function initClock(){
if(store.simIdx==null) store.simIdx=-1;
}
