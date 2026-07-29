import { S } from './state.js';
import { POOL, RAIL, pLive } from './clock.js';
import { byeFor, hydrateRosters, weekGame } from './data/nfl-index.js';
import { NFL_PLAYERS } from './data/nfl-players.js';
import { HIST_SEASONS, histLeaders } from './data/nfl-history.js';
import { applyDraftToRosters, draftPicks, takenIds } from './draft.js';
import { availableListHTML, faOpen, isRostered, renderAvailable } from './freeagency.js';
import { LIVE_WEEK, MAXW, MINW } from './lineup.js';
import { ageBit, faceInner, pKeyOf, posMatch } from './player.js';
import { esc } from './team.js';

// ---- shared panel search (Leaders / Trending / Available) ----
export const panelQ={leaders:'',trending:'',available:''};
export const PANEL_CAP=100;   // the pool is ~900 deep; search narrows it
export function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
export function escAttr(s){return escHtml(s).replace(/"/g,'&quot;');}
// name / team / exact position match
export function matchQ(p,q){
  q=(q||'').trim().toLowerCase();if(!q)return true;
  return (p.n||'').toLowerCase().includes(q)||(p.tm||'').toLowerCase().includes(q)||(p.pos||'').toLowerCase()===q;
}
export function searchBar(kind,ph){
  const q=panelQ[kind]||'';
  return `<div class="psearch">
    <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
    <input id="panelSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
      placeholder="${escAttr(ph)}" value="${escAttr(q)}" oninput="onPanelSearch('${kind}',this.value)">
    <span class="clr${q?' on':''}" onclick="clearPanelSearch('${kind}')">✕</span>
  </div>`;
}
export function panelListHTML(kind){
  return kind==='leaders'?leadersListHTML():kind==='trending'?trendingListHTML():availableListHTML();
}
// repaint rows only, so the input keeps focus and the caret while typing
export function paintPanelList(kind){
  const el=document.getElementById('panelList');if(el)el.innerHTML=panelListHTML(kind);
}
export function onPanelSearch(kind,v){
  panelQ[kind]=v;
  const c=document.querySelector('#panel .psearch .clr');if(c)c.classList.toggle('on',!!v);
  paintPanelList(kind);
}
export function clearPanelSearch(kind){
  panelQ[kind]='';
  const i=document.getElementById('panelSearch');if(i){i.value='';i.focus();}
  onPanelSearch(kind,'');
}
export function noHits(kind,fallback){
  const q=panelQ[kind];
  return q&&q.trim()?`<div class="empty">No player matches<br><b style="color:#93A0B0">${escHtml(q)}</b></div>`:`<div class="empty">${fallback}</div>`;
}
export function pillsHTML(active,fn){
  return `<div class="pillrow">${['ALL','QB','RB','WR','TE','FLEX']
    .map(pl=>`<div class="pill ${pl===active?'on':''}" onclick="${fn}('${pl}')">${pl}</div>`).join('')}</div>`;
}
// swap the active pill in place — keeps both the pill scroll position and search focus
export function setPills(active){
  document.querySelectorAll('#panel .pillrow .pill').forEach(el=>el.classList.toggle('on',el.textContent.trim()===active));
}

export function trendingListHTML(){
  const t=takenIds();
  const list=NFL_PLAYERS.filter(p=>posMatch(p.pos,S.trendPos)&&matchQ(p,panelQ.trending))
    .sort((a,b)=>a.adp-b.adp);
  if(!list.length)return noHits('trending',`No ${S.trendPos} players`);
  return list.slice(0,PANEL_CAP).map(p=>`<div class="tr-row" onclick="openPlayer('${esc(p.id)}')">
    <span class="tr-rk">${p.adp}</span>
    <span class="tr-face">${faceInner(p.id)}</span>
    <div class="tr-info"><div class="tr-nm">${p.full}${p.exp===0?'<span class="rk-badge">R</span>':''}</div>
      <div class="tr-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}${p.age!=null?` · ${p.age}`:''} · ${p.sproj.toFixed(0)} proj</div></div>
    <div class="tr-add">${t.has(p.id)?'DRAFTED':'ADP '+p.adp}</div>
  </div>`).join('');
}
export function renderTrending(){
  document.getElementById('panel').innerHTML=
    `<div class="panel-hd"><span class="d"></span>Draft Board <span class="wk">· ADP · 10-team PPR</span></div>
     ${searchBar('trending','Search the board')}
     ${pillsHTML(S.trendPos,'setTrendPos')}
     <div id="panelList">${trendingListHTML()}</div>`;
}
export function setTrendPos(pl){S.trendPos=pl;setPills(pl);paintPanelList('trending');}

// leaders panel: position filter + metric (points / projected) + scope (season / one week)
export let leaderPos='ALL', leaderMetric='proj';
export function seededPts(week,key,pos){
  let h=2166136261;const s=key+'@'+week;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  h=(h>>>0)%1000;
  const R={QB:[12,230],RB:[5,260],WR:[4,270],TE:[2,180]}[pos]||[3,200];
  return Math.round((R[0]+(h%R[1])/10)*10)/10;
}
// one week's projection: the season rate with a stable weekly wobble, 0 on the bye
export function wkProj(p,w){
  if(byeFor(p.tm)===+w)return 0;
  const base=p.proj!=null?p.proj:(p.sproj||0)/17;
  let h=2166136261;const str=(p.id||p.n||'')+'#'+w;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return Math.round(base*(0.74+((h>>>0)%54)/100)*10)/10;
}
// actual points — null until that week has been played (nothing has kicked off at LIVE_WEEK 0)
export function wkPts(p,w){
  if(+w>LIVE_WEEK)return null;
  if(byeFor(p.tm)===+w)return 0;
  return pLive(wkProj(p,w),p.full||p.n||'');
}
export function seasonPts(p){
  let t=0,any=false;
  for(let w=MINW;w<=MAXW&&w<=LIVE_WEEK;w++){const v=wkPts(p,w);if(v!=null){t+=v;any=true;}}
  return any?Math.round(t*10)/10:null;
}
export function leaderVal(p){
  if(S.leaderScope==='season')return leaderMetric==='pts'?seasonPts(p):(p.sproj||0);
  return leaderMetric==='pts'?wkPts(p,S.leaderWeek):wkProj(p,S.leaderWeek);
}
export function leaderFmt(v){
  if(v==null)return '—';
  return (S.leaderScope==='season'&&leaderMetric==='proj')?v.toFixed(0):v.toFixed(1);
}
export function leaderMeta(p){
  if(S.leaderScope==='season')return `ADP ${p.adp}`;
  const g=weekGame(p.tm,S.leaderWeek);
  return g?(g.home?'vs ':'@ ')+g.opp:'BYE';
}
// ---- past seasons ----
// Real production, not the simulation: nflverse regular-season totals baked into
// js/data/nfl-history.js. A completed season has no projection and no upcoming
// opponent, so those controls are hidden while one is selected and the metric
// switches to points per game.
export function histOn(){ return HIST_SEASONS.indexOf(+S.leaderScope) > -1; }
function histMatch(r,q){
  q=(q||'').trim().toLowerCase();if(!q)return true;
  return r.name.toLowerCase().includes(q)||r.tm.toLowerCase().includes(q)||r.pos.toLowerCase()===q;
}
export function histListHTML(){
  const year=+S.leaderScope;
  const val=r=>leaderMetric==='ppg'?r.ppg:leaderMetric==='std'?r.std:r.ppr;
  // stored best-PPR first; per-game and standard are different orders entirely
  const rows=histLeaders(year,leaderPos).filter(r=>histMatch(r,panelQ.leaders))
    .slice().sort((a,b)=>val(b)-val(a));
  if(!rows.length)return noHits('leaders',`No ${leaderPos} players in ${year}`);
  return rows.slice(0,PANEL_CAP).map((r,i)=>{
    // still on a roster: keep the face and let the row open their profile
    const face=r.id?faceInner(r.id):`<span class="ld-init">${escHtml(
      r.name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span>`;
    const open=r.id?` onclick="openPlayer('${esc(r.id)}')"`:'';
    return `<div class="ld-row${r.id?'':' ld-gone'}"${open}><span class="ld-rk">${i+1}</span>
        <span class="ld-face">${face}</span>
        <div class="ld-info"><div class="ld-nm">${escHtml(r.name)}</div>
          <div class="ld-mt"><span class="pos ${r.pos}">${r.pos}</span> · ${escHtml(r.tm)} · ${r.g} games</div></div>
        <span class="ld-pt">${val(r).toFixed(1)}</span></div>`;
  }).join('');
}

export function leadersListHTML(){
  if(histOn())return histListHTML();
  const rows=POOL.filter(p=>posMatch(p.pos,leaderPos)&&matchQ(p,panelQ.leaders))
    .map(p=>({p,v:leaderVal(p)}))
    .sort((a,b)=>((b.v==null?-1:b.v)-(a.v==null?-1:a.v))||(b.p.sproj-a.p.sproj));
  if(!rows.length)return noHits('leaders',`No ${leaderPos} players`);
  return rows.slice(0,PANEL_CAP).map((r,i)=>{
    const p=r.p;
    const add=(faOpen()&&!isRostered(pKeyOf(p)))
      ?`<span class="av-add" onclick="event.stopPropagation();addPlayer('${esc(pKeyOf(p))}')">+</span>`:'';
    return `<div class="ld-row" onclick="openPlayer('${esc(p.id)}')"><span class="ld-rk">${i+1}</span>
        <span class="ld-face">${faceInner(p.id)}</span>
        <div class="ld-info"><div class="ld-nm">${p.full}</div><div class="ld-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}${ageBit(pKeyOf(p))} · ${leaderMeta(p)}</div></div>
        <span class="ld-pt${r.v==null?' none':''}">${leaderFmt(r.v)}</span>${add}</div>`;
  }).join('');
}
export function leaderScopeOpts(){
  const o=[`<option value="season"${S.leaderScope==='season'?' selected':''}>2026 Season</option>`];
  for(let w=MINW;w<=MAXW;w++)o.push(`<option value="w${w}"${S.leaderScope==='week'&&S.leaderWeek===w?' selected':''}>Wk ${w}</option>`);
  o.push('<option disabled>──────</option>');
  HIST_SEASONS.forEach(y=>o.push(
    `<option value="${y}"${+S.leaderScope===y?' selected':''}>${y}</option>`));
  return o.join('');
}
function leaderMetricOpts(){
  const opts=histOn()
    ? [['ppr','PPR'],['ppg','Per game'],['std','Standard']]
    : [['proj','Proj'],['pts','Points']];
  return opts.map(([v,l])=>
    `<option value="${v}"${leaderMetric===v?' selected':''}>${l}</option>`).join('');
}
export function renderLeaders(){
  document.getElementById('panel').innerHTML=
    `<div class="panel-hd sm"><span class="d"></span>Leaders
       <select class="hd-sel" onchange="setLeaderMetric(this.value)">${leaderMetricOpts()}</select>
       <select class="hd-sel" onchange="setLeaderScope(this.value)">${leaderScopeOpts()}</select>
     </div>
     ${histOn()?`<div class="ld-note">Real ${S.leaderScope} regular-season production</div>`:''}
     ${searchBar('leaders','Search all players')}
     ${pillsHTML(leaderPos,'setLeaderPos')}
     <div id="panelList">${leadersListHTML()}</div>`;
}
export function setLeaderPos(pl){leaderPos=pl;setPills(pl);paintPanelList('leaders');}
export function setLeaderMetric(v){leaderMetric=v;paintPanelList('leaders');}
export function setLeaderScope(v){
  const was=histOn();
  if(v==='season')S.leaderScope='season';
  else if(HIST_SEASONS.indexOf(+v)>-1)S.leaderScope=+v;
  else{S.leaderScope='week';S.leaderWeek=+v.slice(1);}
  // Crossing between the live season and a past one swaps the metric list, and
  // switching between two past seasons has to restamp the year in the note - so
  // anything touching a past season repaints the whole rail, not just the rows.
  if(histOn()||was){
    if(histOn()!==was)leaderMetric=histOn()?'ppr':'pts';
    renderLeaders();
    return;
  }
  paintPanelList('leaders');
}

export let currentRail='leaders';
export function renderPanel(key){
  currentRail=key;
  const p=document.getElementById('panel');
  if(key==='leaders'){
    renderLeaders();
  } else if(key==='trending'){
    renderTrending();
  } else if(key==='available'){
    renderAvailable();
  } else {
    const lb=RAIL.find(r=>r.k===key).lb;
    p.innerHTML=`<div class="panel-hd"><span class="d"></span>${lb} <span class="wk">· Week ${S.week}</span></div>
      <div class="empty">The <b style="color:#93A0B0">${lb}</b> panel would load here.<br>Send me the ${lb} data and I'll fill it like Trending.</div>`;
  }
}
// rail




export function selectRail(key){
  document.querySelectorAll('.rail-item').forEach(el=>el.classList.toggle('on',el.dataset.rail===key));
  renderPanel(key);
}





// Ran at top level in the original single-file script. main.js calls it
// during boot so it keeps its original position in the startup order.
export function initPanel(){
document.getElementById('rail').innerHTML = RAIL.map(r=>`
  <div class="rail-item ${r.k==='leaders'?'on':''}" data-rail="${r.k}" onclick="${r.action||`selectRail('${r.k}')`}">
    <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.ic}</svg></span>
    <span class="lb">${r.lb}</span></div>`).join('');
if(draftPicks().length)applyDraftToRosters();
hydrateRosters(S.week);
renderPanel('leaders');
}
