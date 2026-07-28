import { S } from './state.js';
import { DRAFT_ORDER, DRAFT_TOTAL, ROSTER_CAP, STARTER_NEED, slotAllows } from './clock.js';
import { hydratePlayer } from './data/nfl-index.js';
import { NFL_BY_ID, NFL_PLAYERS } from './data/nfl-players.js';
import { MY_TEAM } from './data/teams.js';
import { renderDraft } from './draft-ui.js';
import { invalidateRosters } from './freeagency.js';
import { renderTabs, showTab, toast } from './nav.js';
import { currentRail, renderPanel } from './panel.js';
import { BENCH, IR, LINEUP, TAXI, saveStore, store } from './store.js';
import { refreshApp } from './team.js';

// ======================= DRAFT =======================
// 10-team snake, 15 rounds.
//
// store.draft.picks holds a record per pick, in overall order:
//   { id, ts, ms, auto, react }
// It used to be bare id strings; migrateDraft() in draft-meta.js lifts old saves.
// Anything that just wants the players uses pickIds().
export function draftPicks(){if(!store.draft)store.draft={picks:[]};return store.draft.picks;}
export function pickIds(){return draftPicks().map(r=>r&&r.id);}
export function pickAt(overall){return draftPicks()[overall]||null;}
export function draftDone(){return draftPicks().length>=DRAFT_TOTAL;}
// snake: odd rounds run down the order, even rounds run back up
export function teamOnPick(i){
  const n=DRAFT_ORDER.length, rd=Math.floor(i/n), k=i%n;
  return DRAFT_ORDER[rd%2===0?k:n-1-k];
}
export function pickMeta(i){const n=DRAFT_ORDER.length;return {round:Math.floor(i/n)+1,pick:i%n+1,team:teamOnPick(i)};}
export function onClockIdx(){return draftPicks().length;}
export function onClockTeam(){return draftDone()?null:teamOnPick(onClockIdx());}
export function myTurn(){return onClockTeam()===MY_TEAM;}

export let _taken=null;
export function takenIds(){if(!_taken)_taken=new Set(pickIds());return _taken;}
export function draftBoard(){   // undrafted, ADP order
  const t=takenIds();
  return NFL_PLAYERS.filter(p=>!t.has(p.id)).sort((a,b)=>a.adp-b.adp);
}
export function teamRosterIds(key){
  const out=[];draftPicks().forEach((r,i)=>{if(teamOnPick(i)===key)out.push(r&&r.id);});return out;
}
export function posCount(key){
  const c={QB:0,RB:0,WR:0,TE:0};
  teamRosterIds(key).forEach(id=>{const p=NFL_BY_ID[id];if(p)c[p.pos]++;});return c;
}
// autopick: fill starting requirements first, then best available inside positional caps
export function autoPick(key){
  const c=posCount(key),board=draftBoard();
  const need=p=>c[p.pos]<STARTER_NEED[p.pos];
  const room=p=>c[p.pos]<ROSTER_CAP[p.pos];
  return (board.find(p=>need(p)&&room(p))||board.find(room)||board[0]||null);
}
/** `opts.auto` marks a pick the clock made; `opts.ms` is how long the owner took. */
export function commitPick(id,opts){
  if(!id||draftDone())return false;
  const o=opts||{};
  store.draft.picks.push({id,ts:o.ts||null,ms:o.ms==null?null:o.ms,auto:!!o.auto,react:{}});
  _taken=null;saveStore();
  if(draftDone()){applyDraftToRosters();renderTabs();invalidateRosters();renderPanel(currentRail);}
  return true;
}
// When the user's turn began, so a submitted pick can be timed for the clutch
// badge. Reset every time control passes back to them.
let clockStart = Date.now();
export function markOnClock(){ clockStart = Date.now(); }

// run the AI teams until it's the user's turn again (or the draft ends)
export function runAutoPicks(){
  let guard=0;
  while(!draftDone()&&!myTurn()&&guard++<DRAFT_TOTAL){
    const t=onClockTeam(),p=autoPick(t);
    if(!p)break;
    commitPick(p.id,{auto:true,ts:Date.now()});
  }
  markOnClock();
}
export function draftPlayer(id){
  if(!myTurn()){toast('Not your pick');return;}
  const p=NFL_BY_ID[id];if(!p)return;
  const c=posCount(MY_TEAM);
  if(c[p.pos]>=ROSTER_CAP[p.pos]){toast(`Roster limit reached at ${p.pos}`);return;}
  commitPick(id,{auto:false,ts:Date.now(),ms:Date.now()-clockStart});
  toast(`Drafted ${p.full}`);
  runAutoPicks();
  renderDraft();refreshApp();
}
export function simToMyPick(){runAutoPicks();renderDraft();refreshApp();}
export function autoDraftAll(){
  let guard=0;
  while(!draftDone()&&guard++<DRAFT_TOTAL+5){
    const t=onClockTeam(),p=autoPick(t);if(!p)break;commitPick(p.id,{auto:true,ts:Date.now()});
  }
  renderDraft();refreshApp();
}
export function resetDraft(){const cfg=store.draft&&store.draft.cfg;store.draft={picks:[],cfg};markOnClock();_taken=null;saveStore();clearRosters();showTab('draft');refreshApp();renderPanel(currentRail);}

export function clearRosters(){
  LINEUP.forEach(r=>{r.a=null;r.x=null;});
  [BENCH,IR,TAXI].forEach(arr=>arr.forEach(r=>{r.a=null;r.x=null;}));
  S.pidx=null;invalidateRosters&&invalidateRosters();
}
// slot a drafted roster into starters (best projection first) then bench
export function fillSide(key,side){
  const ids=teamRosterIds(key).map(id=>NFL_BY_ID[id]).filter(Boolean)
    .sort((a,b)=>b.sproj-a.sproj);
  const used=new Set();
  LINEUP.forEach(r=>{
    const p=ids.find(q=>!used.has(q.id)&&slotAllows(r.slot,q.pos));
    if(p){used.add(p.id);r[side]=hydratePlayer(mkPlayer(p),S.week);}
  });
  const rest=ids.filter(q=>!used.has(q.id));
  BENCH.forEach((r,i)=>{r[side]=rest[i]?hydratePlayer(mkPlayer(rest[i]),S.week):null;});
}
export function mkPlayer(p){return {id:p.id,n:p.n,full:p.full,pos:p.pos,tm:p.tm,num:p.num,exp:p.exp,hs:p.hs,proj:p.proj};}
export function applyDraftToRosters(){
  clearRosters();
  fillSide(MY_TEAM,'a');
  fillSide('radiator','x');   // Week 1 opponent
  S.pidx=null;
}
