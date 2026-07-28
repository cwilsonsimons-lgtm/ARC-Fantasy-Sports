import { S } from './state.js';
import { POOL, ROSTER_CAP, isLocked, recomputeLT } from './clock.js';
import { byeFor, gameLabel, hydratePlayer } from './data/nfl-index.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { MY_TEAM } from './data/teams.js';
import { draftDone, myTurn, posCount, takenIds } from './draft.js';
import { getGames, renderLeagueBody } from './lineup.js';
import { renderUserMatchup } from './matchup.js';
import { toast } from './nav.js';
import { PANEL_CAP, currentRail, matchQ, noHits, paintPanelList, panelQ, pillsHTML, renderPanel, searchBar, seededPts, setPills } from './panel.js';
import { faceInner, pIdx, pKeyOf, posMatch, renderPlayer, renderStandings } from './player.js';
import { BENCH, LINEUP, TAXI, saveStore, store } from './store.js';
import { collectSide, currentTeamKey, esc, renderTeam } from './team.js';

// ===== ADD / CUT (free agency) =====
// persist my full a-side roster (survives swaps, adds, and cuts) as player objects
export function persistRoster(){
  store.roster={
    starters:LINEUP.map(r=>r.a||null),
    bench:BENCH.map(r=>r.a||null),
    taxi:TAXI.map(r=>r.a||null)
  };
  saveStore();
}
export function applyStoredRoster(){
  const R=store.roster;
  if(!R){applyStoredLineup();return;} // fall back to legacy name-only lineup
  if(Array.isArray(R.starters)) R.starters.forEach((p,i)=>{if(LINEUP[i])LINEUP[i].a=p||null;});
  if(Array.isArray(R.bench)) R.bench.forEach((p,j)=>{if(BENCH[j])BENCH[j].a=p||null;else BENCH.push({a:p||null,x:null});});
  if(Array.isArray(R.taxi)) R.taxi.forEach((p,j)=>{if(TAXI[j])TAXI[j].a=p||null;else TAXI.push({a:p||null,x:null});});
}
// legacy: old builds stored only names; keep so early savers don't lose their lineup
export function applyStoredLineup(){
  const L=store.lineup;if(!L||!L.starters)return;
  const pool={};
  LINEUP.forEach(r=>{if(r.a)pool[r.a.n]=r.a;});
  BENCH.forEach(r=>{if(r.a)pool[r.a.n]=r.a;});
  const orig=[...LINEUP.map(r=>r.a&&r.a.n),...BENCH.map(r=>r.a&&r.a.n)].filter(Boolean).sort().join('|');
  const saved=[...(L.starters||[]),...(L.bench||[])].filter(Boolean).sort().join('|');
  if(orig!==saved)return;
  L.starters.forEach((nm,i)=>{if(LINEUP[i]&&nm&&pool[nm])LINEUP[i].a=pool[nm];});
  L.bench.forEach((nm,j)=>{if(BENCH[j]&&nm&&pool[nm])BENCH[j].a=pool[nm];});
}

export function myRosterNames(){const s=new Set();[LINEUP,BENCH,TAXI].forEach(A=>A.forEach(r=>{if(r.a)s.add(r.a.n);}));return s;}
// a player is "on a team" if they're on a real roster: mine or my current opponent's.
// (other teams' rosters are procedural filler, so they don't lock players out of free agency)
export var _rosterCache=null;
export function rosteredNames(){
  if(_rosterCache)return _rosterCache;
  const s=new Set();
  collectSide('a').forEach(p=>{if(p&&p.n){s.add(p.n);if(p.id)s.add(p.id);}});
  collectSide('x').forEach(p=>{if(p&&p.n){s.add(p.n);if(p.id)s.add(p.id);}});
  _rosterCache=s;return s;
}
export function isRostered(key){return rosteredNames().has(key);}
// free agency is shut until the draft finishes — before that, the draft board is the
// only way a player moves onto a roster, and only when you're on the clock
export function faOpen(){return draftDone();}
export function canDraftNow(id){
  if(faOpen()||!id||!myTurn())return false;
  const p=NFL_BY_ID[id];
  if(!p||takenIds().has(id))return false;
  const cap=ROSTER_CAP[p.pos];
  return cap==null||posCount(MY_TEAM)[p.pos]<cap;
}
export function invalidateRosters(){_rosterCache=null;}
// free agents = trending + leaders pool who aren't on any team, sorted by this week's projection (desc)
export function freeAgents(posFilter){
  const taken=rosteredNames(),drafted=takenIds(),seen=new Set(),list=[];
  const push=p=>{const k=p&&(p.id||p.n);
    if(!p||!p.n||seen.has(k)||(p.id&&drafted.has(p.id)))return;
    if(p.id?taken.has(p.id):taken.has(p.n))return;
    seen.add(k);
    list.push({id:p.id||null,n:p.n,full:p.full||p.n,pos:p.pos,tm:p.tm,bye:byeFor(p.tm),adp:p.adp||999,
      g:gameLabel(p.tm,S.week)||p.game||p.g||'',proj:p.proj!=null?p.proj:seededPts(S.week,p.n,p.pos)});};
  POOL.forEach(push);
  return list.filter(p=>posFilter==='ALL'?true:posMatch(p.pos,posFilter)).sort((a,b)=>b.proj-a.proj);
}
export function addPlayer(key){
  if(!faOpen())return;
  const fa=freeAgents('ALL').find(p=>pKeyOf(p)===key)||freeAgents('ALL').find(p=>p.n===key);if(!fa)return;
  const name=fa.full||fa.n;
  const p=hydratePlayer({id:fa.id,n:fa.n,full:fa.full,pos:fa.pos,tm:fa.tm,proj:fa.proj},S.week);
  let slot=BENCH.findIndex(r=>!r.a);
  if(slot>-1)BENCH[slot].a=p;else BENCH.push({a:p,x:null});
  S.pidx=null;invalidateRosters();persistRoster();refreshRosterViews();
  toast(`${name} added to your bench`);
}
export function cutPlayer(key){
  const hit=r=>r.a&&(pKeyOf(r.a)===key||r.a.n===key);
  const li=LINEUP.findIndex(hit);
  if(li>-1&&isLocked(LINEUP[li].a)){toast('Locked — game already started');return;}
  const rec=pIdx()[key],name=(rec&&rec.full)||key;
  let found=false;
  [LINEUP,BENCH,TAXI].forEach(A=>A.forEach(r=>{if(hit(r)){r.a=null;found=true;}}));
  if(!found)return;
  S.pidx=null;invalidateRosters();persistRoster();
  refreshRosterViews();
  toast(`${name} dropped to free agency`);
}
export function confirmDrop(key){
  const r=pIdx()[key],name=(r&&(r.full||r.n))||key;
  openConfirm(`Drop ${name}?`,`${name} will be released to free agency. Any custom photo or nickname is kept, and you can re-add them later.`,()=>cutPlayer(key));
}
export function refreshRosterViews(){
  recomputeLT();S.games=getGames(S.week);
  renderLeagueBody();renderUserMatchup();renderStandings();
  const tv=document.querySelector('.view[data-view="team"]');
  if(tv&&tv.classList.contains('on')&&currentTeamKey)renderTeam(currentTeamKey);
  const pv=document.querySelector('.view[data-view="player"]');
  if(pv&&pv.classList.contains('on')&&S.currentPlayerName)renderPlayer(S.currentPlayerName);
  renderPanel(currentRail); // keep Trending/Leaders/Available +buttons in sync with the roster
}

// ---- Available (free agents) panel — lives in the sidebar rail ----
export let availPos='ALL';
export function availRow(p,i){
  return `<div class="ld-row" onclick="openPlayer('${esc(pKeyOf(p))}')">
    <span class="ld-rk">${i+1}</span>
    <span class="ld-face">${faceInner(pKeyOf(p))}</span>
    <div class="ld-info"><div class="ld-nm">${p.n}</div><div class="ld-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}${p.bye?` (${p.bye})`:''} · ${p.g||'—'}</div></div>
    <span class="ld-pt">${p.proj.toFixed(1)}</span>
    ${faOpen()?`<span class="av-add" onclick="event.stopPropagation();addPlayer('${esc(pKeyOf(p))}')">+</span>`:''}
  </div>`;
}
export function availableListHTML(){
  const list=freeAgents(availPos).filter(p=>matchQ(p,panelQ.available)).sort((a,b)=>(a.adp||999)-(b.adp||999));
  return list.length?list.slice(0,PANEL_CAP).map(availRow).join(''):noHits('available',`No available ${availPos} players<br>right now`);
}
export function renderAvailable(){
  document.getElementById('panel').innerHTML=
    `<div class="panel-hd"><span class="d"></span>Available <span class="wk">· undrafted · ADP order</span></div>
     ${searchBar('available','Search free agents')}
     ${pillsHTML(availPos,'setAvailPos')}
     <div id="panelList">${availableListHTML()}</div>`;
}
export function setAvailPos(pl){availPos=pl;setPills(pl);paintPanelList('available');}
// ---- confirm sheet ----
export let _confirmCb=null;
export function openConfirm(title,msg,cb){
  _confirmCb=cb;
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmBody').innerHTML=`<div class="cf-msg">${msg}</div>
    <div class="cf-btns"><div class="cf-btn cancel" onclick="closeConfirm()">Cancel</div>
    <div class="cf-btn danger" onclick="doConfirm()">Drop</div></div>`;
  document.getElementById('confirmScrim').classList.add('show');
  document.getElementById('confirmSheet').classList.add('show');
}
export function closeConfirm(){document.getElementById('confirmScrim').classList.remove('show');document.getElementById('confirmSheet').classList.remove('show');_confirmCb=null;}
export function doConfirm(){const cb=_confirmCb;closeConfirm();if(cb)cb();}
