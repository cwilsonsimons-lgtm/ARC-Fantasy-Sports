import { S } from './state.js';
import { DRAFT_ORDER, POOL, slotAllows } from './clock.js';
import { hydratePlayer, pkey } from './data/nfl-index.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { mkPlayer, teamRosterIds } from './draft.js';
import { FONT_BY_KEY, MY_TEAM, T, TEAM_FONTS, applyTeamFonts } from './data/teams.js';
import { renderDraft } from './draft-ui.js';
import { renderLeagueBody } from './lineup.js';
import { renderUserMatchup } from './matchup.js';
import { renderTabs, showLeagueView, showTab, showView, toggleDrawer } from './nav.js';
import { seededPts } from './panel.js';
import { faceInner, leaguePlayers, pKeyOf, playerNick, renderStandings } from './player.js';
import { BENCH, LINEUP, TAXI, processImage, saveStore, store } from './store.js';

// ---------- TEAM SCREEN ----------
export const ICON_CAM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>';
export const ICON_X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>';
export const ICON_GEAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/></svg>';
export const ICON_UP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v4h16v-4"/></svg>';
export const ICON_STAR='<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.9 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
export let currentTeamKey=null, photoTargetName=null;
export function esc(s){return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}
export function currentViewName(){const v=document.querySelector('.view.on');return v?v.dataset.view:'matchup';}

// rosters: my team + current opponent use the real lineup; the rest are read
// back out of the draft, so a player belongs to exactly one team.
export function collectSide(side){
  const out=[];
  LINEUP.forEach(r=>{if(r[side])out.push({...r[side],slot:r.slot,group:'STARTERS'});});
  BENCH.forEach(r=>{if(r[side])out.push({...r[side],group:'BENCH'});});
  TAXI.forEach(r=>{if(r[side])out.push({...r[side],group:'TAXI SQUAD'});});
  return out;
}
// The draft already guarantees uniqueness - a drafted id leaves the board - so
// slotting a team's own picks is the only way to be sure nobody is on two
// rosters. Slotting mirrors fillSide(): best projection into each starting slot
// it is eligible for, everyone else to the bench.
export function draftedRoster(key){
  const ids=teamRosterIds(key).map(id=>NFL_BY_ID[id]).filter(Boolean)
    .sort((a,b)=>b.sproj-a.sproj);
  if(!ids.length) return null;
  const used=new Set(),out=[];
  LINEUP.forEach(r=>{
    const p=ids.find(q=>!used.has(q.id)&&slotAllows(r.slot,q.pos));
    if(p){used.add(p.id);out.push({...hydratePlayer(mkPlayer(p),S.week),slot:r.slot,group:'STARTERS'});}
  });
  ids.filter(q=>!used.has(q.id)).forEach(p=>
    out.push({...hydratePlayer(mkPlayer(p),S.week),group:'BENCH'}));
  return out;
}
// Only reachable before the draft, when no team has real picks yet. Deal the
// pool round-robin by team index so these placeholder rosters are still
// disjoint - the old version sampled per team and handed the same player out
// more than once.
export function mockRoster(key){
  const keys=DRAFT_ORDER,k=keys.length||1;
  const ti=Math.max(0,keys.indexOf(key)),out=[];
  for(let i=ti;i<POOL.length&&out.length<14;i+=k){
    const p=POOL[i];
    // carry the id: short names repeat across the league (two D. Moores, four
    // T. Johnsons), and photos and nicknames are stored per id
    out.push({id:p.id,n:p.n,pos:p.pos,tm:p.tm,proj:seededPts(S.week,p.n+key,p.pos),
      group:out.length<9?'STARTERS':'BENCH'});
  }
  return out;
}
export function rosterFor(key){
  if(key===MY_TEAM) return collectSide('a');
  if(key==='radiator') return collectSide('x');
  return draftedRoster(key)||mockRoster(key);
}

export function teamHead(t,own){
  const crestInner=t.logo?`<img src="${t.logo}" alt="" style="width:100%;height:100%;object-fit:cover">`:t.mono;
  const logoCam=own?`<span class="cam" onclick="document.getElementById('logoInput').click()">${ICON_CAM}</span>`:'';
  const nameBlock=own
    ? `<input class="tv-name-input" value="${esc(t.n)}" maxlength="30" onchange="setTeamName(this.value)">`
    : `<div class="tv-name tf-${currentTeamKey}" style="color:${t.c}">${t.n}</div>`;
  const editRow=own?`
    <div class="tv-edit-row">
      <span class="tv-swatch">Primary <input type="color" value="${t.c}" onchange="setColor('c',this.value)"></span>
      <span class="tv-swatch">Backdrop <input type="color" value="${t.bg}" onchange="setColor('bg',this.value)"></span>
      <span class="tv-mini-btn" onclick="document.getElementById('logoInput').click()">${ICON_UP} Upload logo</span>
    </div>
    ${fontDropdownHTML(t)}`:'';
  const ownTag=own?`<div class="tv-own-tag">${ICON_STAR}</div>`:'';
  // Another manager's team is the one place a one-to-one thread starts. There
  // is no DM list to find them in — you open the team, then you open the thread.
  const msgBtn=own?'':`<div class="tv-msg" onclick="openThread('${currentTeamKey}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.5 8.5 0 1 1 21 11.5Z"/></svg>
    </div>`;
  return `<div class="tv-head">
    <div class="tv-band" style="background:linear-gradient(90deg,${t.c},transparent)"></div>
    <div class="tv-top">
      <div class="tv-crest" style="background:linear-gradient(155deg,${t.bg},#171416);border:1.5px solid ${t.c};color:${t.c}">${crestInner}${logoCam}</div>
      <div class="tv-idwrap">${nameBlock}<div class="tv-sub">${t.mgr} · ${t.rec} · #${t.rk}</div>${ownTag}</div>
      ${msgBtn}
    </div>
    ${editRow}
  </div>`;
}
/** `opts.drop` is off for a seeded league: photos and nicknames are per-league
 *  and safe to edit anywhere, but Drop reaches into the real LINEUP, so
 *  offering it on another league's roster would cut a player from City Boys
 *  Dynasty instead. */
export function teamRow(p,own,opts){
  opts=opts||{};
  const canDrop=own&&opts.drop!==false;
  const cam=own?`<span class="cam">${ICON_CAM}</span>`:'';
  const faceClick=own?`onclick="event.stopPropagation();pickPhoto('${esc(pKeyOf(p))}')"`:'';
  // FLEX is worth calling out; "QB · QB" is not
  const slot=(p.slot&&p.slot!==p.pos)?`<span class="slot">${p.slot}</span> · `:'';
  const nick=own
    ? `<input class="tv-nick-input" placeholder="add nickname" value="${esc(playerNick(pKeyOf(p)))}" onclick="event.stopPropagation()" onchange="setNick('${esc(pKeyOf(p))}',this.value)">`
    : (playerNick(p.n)?`<div class="tv-nick">“${playerNick(p.n)}”</div>`:'');
  const rt=canDrop
    ? `<div class="tv-rt"><div class="tv-pts">${(p.proj||0).toFixed(1)}</div>
        <span class="tv-drop" onclick="event.stopPropagation();confirmDrop('${esc(pKeyOf(p))}')">Drop</span></div>`
    : `<div class="tv-pts">${(p.proj||0).toFixed(1)}</div>`;
  return `<div class="tv-row" onclick="openPlayer('${esc(pKeyOf(p))}')">
    <div class="tv-face${own?' editable':''}" ${faceClick}>${faceInner(pKeyOf(p))}${cam}</div>
    <div class="tv-pinfo">
      <div class="tv-pn">${p.n}</div>
      ${nick}
      <div class="tv-pmeta">${slot}${p.pos} · ${p.tm}${p.bye?` (${p.bye})`:''}</div>
    </div>
    ${rt}
  </div>`;
}
export function renderTeam(key){
  currentTeamKey=key;
  const t=T[key],own=(key===MY_TEAM),roster=rosterFor(key);
  let body=teamHead(t,own);
  ['STARTERS','BENCH','TAXI SQUAD'].forEach(gp=>{
    const list=roster.filter(p=>p.group===gp);
    if(!list.length)return;
    body+=`<div class="tv-sec-hd">${gp}</div><div class="tv-roster">${list.map(p=>teamRow(p,own)).join('')}</div>`;
  });
  body+=`<input type="file" accept="image/*" class="hidden-file" id="playerPhotoInput" onchange="onPlayerPhoto(this)">
         <input type="file" accept="image/*" class="hidden-file" id="logoInput" onchange="onLogo(this)">`;
  document.getElementById('teamBody').innerHTML=body;
}
export function openTeam(key){
  if(!T[key])return;
  const cur=currentViewName();
  if(cur!=='team') S.teamBackView=cur;
  const lbl={league:'All matchups',standings:'Standings',detail:'Matchup'}[S.teamBackView]||'Matchup';
  document.getElementById('teamBackLabel').textContent=lbl;
  renderTeam(key);
  showView('team');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab==='team'&&key===MY_TEAM));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function teamBack(){fontMenuOpen=false;
  const v=S.teamBackView;
  // a roster reached from a seeded league returns to that league, not to yours
  if(v==='seeded'&&S.seededBack&&window.openLeague){window.openLeague(S.seededBack);return;}
  if(v==='league')showLeagueView();
  else if(v==='standings')showTab('standings');
  else if(v==='detail'){showView('detail');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));document.getElementById('scroll').scrollTop=0;}
  else showTab('matchup');
}
// ---- edit handlers (own team only) ----
export function pickPhoto(key){photoTargetName=key;document.getElementById('playerPhotoInput').click();}
export function onPlayerPhoto(input){
  const f=input.files&&input.files[0];if(!f||!photoTargetName)return;
  const n=photoTargetName;
  processImage(f,600,'image/jpeg',0.82,(url)=>{
    const bag=leaguePlayers();
    bag[pkey(n)]=Object.assign(bag[pkey(n)]||{},{photo:url});
    saveStore();refreshAfterPhoto();
  });
}
export function setNick(name,val){
  const k=pkey(name),bag=leaguePlayers();
  bag[k]=Object.assign(bag[k]||{},{nick:(val||'').trim()});
  saveStore();
}
/** A photo can be set from the real team screen or a seeded one; repaint whichever. */
function refreshAfterPhoto(){
  S.pidx=null;
  if(window.currentSeededTeam&&window.currentSeededTeam.id)
    window.openSeededTeam(window.currentSeededTeam.id,window.currentSeededTeam.key);
  else renderTeam(currentTeamKey);
}
export function onLogo(input){
  const f=input.files&&input.files[0];if(!f)return;
  processImage(f,256,'image/png',0.92,(url)=>{store.team.logo=url;T[MY_TEAM].logo=url;saveStore();renderTeam(MY_TEAM);refreshApp();});
}
export function setTeamName(val){val=(val||'').trim()||T[MY_TEAM].n;store.team.name=val;T[MY_TEAM].n=val;saveStore();document.querySelector('.tv-sub');refreshApp();}
export function setColor(kind,val){store.team[kind]=val;T[MY_TEAM][kind]=val;saveStore();renderTeam(MY_TEAM);refreshApp();}
export function fontPreviewStyle(f,color,size){
  return `font-family:${f.ff},'Oswald',sans-serif;font-weight:${f.w};font-size:calc(${size} * ${f.sc});`
       + `text-transform:${f.tt};letter-spacing:${f.ls};color:${color}`;
}
export let fontMenuOpen=false;
export function fontDropdownHTML(t){
  const cur=FONT_BY_KEY[t.font||'oswald']||FONT_BY_KEY.oswald;
  return `<div class="tv-fontsel">
    <div class="fs-btn${fontMenuOpen?' open':''}" onclick="toggleFontMenu()">
      <span class="fs-lb">Font</span>
      <span class="fs-cur" style="${fontPreviewStyle(cur,t.c,'15px')}">${esc(t.n)}</span>
      <span class="fs-tag">${cur.lb}</span>
      <span class="fs-cv">▾</span>
    </div>
    ${fontMenuOpen?`<div class="fs-menu">${TEAM_FONTS.map(f=>`
      <div class="fs-opt${f.k===cur.k?' on':''}" onclick="setTeamFont('${f.k}')">
        <span class="fs-pv" style="${fontPreviewStyle(f,t.c,'15px')}">${esc(t.n)}</span>
        <span class="fs-nm">${f.lb}</span>
        ${f.k===cur.k?'<span class="fs-ck">✓</span>':''}
      </div>`).join('')}</div>`:''}
  </div>`;
}
export function toggleFontMenu(){fontMenuOpen=!fontMenuOpen;renderTeam(MY_TEAM);}
export function setTeamFont(k){
  fontMenuOpen=false;
  if(FONT_BY_KEY[k]){store.team.font=k;T[MY_TEAM].font=k;saveStore();applyTeamFonts();}
  renderTeam(MY_TEAM);refreshApp();
}
export function refreshApp(){renderTabs();renderLeagueBody();renderUserMatchup();renderStandings();
  if(document.querySelector('.view[data-view="draft"].on'))renderDraft();}
