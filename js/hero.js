import { S } from './state.js';
import { LG } from './data/league-config.js';
import { T } from './data/teams.js';
import { renderLeagueBody } from './lineup.js';
import { renderUserMatchup } from './matchup.js';
import { TABS } from './nav.js';
import { recLabel } from './median.js';
import { isCommish, renderSettings } from './settings.js';
import { processImage, saveStore, store } from './store.js';
import { ICON_CAM, ICON_X } from './team.js';

// ===== STADIUM MATCHUP HERO (shared render) =====
// opts: {compact, tapHint, editBackdrop, status:{cls,txt}}
export function gameKey(a,x){return [a,x].sort().join('__');}
export function backdropFor(a,x){return (store.backdrops&&store.backdrops[gameKey(a,x)])||store.globalBackdrop||null;}
// win% color: projected winner = green, projected loser = red, dead-even = neutral
export function pctColor(mine,theirs){return mine>theirs?'var(--green)':mine<theirs?'var(--red)':'var(--ink-3)';}

// ---- the league logo, at the centre of every matchup ----
//
// It is a child of the centre column, not of the card: that column is the only
// element in the arena whose horizontal centre is fixed. It sits between two
// `flex:1` sides, so it stays on the card's midline however long the team names
// run, whatever size the team logos are, and however wide the score gets - the
// column grows symmetrically around its own centre. Anchoring to the card (or
// to the stage, which also carries the header and the nav) is what put the
// crest off to one side and up over the team logos.
//
// The stacking order is set here and nowhere else:
//   backdrop → league logo → VS + score → team logos, names, records, win %.
// The sides carry a higher z-index than the centre column, so nothing the
// league logo does can reach over a team's own artwork or text.
export function leagueLogoHTML(){
  const src=LG().logo;
  if(src)return `<div class="sh-league" aria-hidden="true"><img src="${src}" alt=""></div>`;
  return `<div class="sh-league def" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35">
      <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>
  </div>`;
}
// A team's record opens their season: every week, the opponent, and how the
// running record got where it is.
export function recHTML(key){
  const t=T[key];
  return `<div class="sh-rec">${t.mgr} · <span class="rec-tap"
    onclick="event.stopPropagation();openSchedule('${key}')">${recLabel(key)}</span></div>`;
}
// full-bleed matchup stage: league chrome + MATCHUP/TEAM/STANDINGS nav + battling logos + scores, all over the backdrop
export function stadiumStageHTML(aKey,xKey,as,xs,aw,xw,ap,xp,opts){
  opts=opts||{};
  const a=T[aKey],x=T[xKey];
  const bdrop=backdropFor(aKey,xKey);
  const bg=bdrop?`<div class="ms-bg" style="background-image:url('${bdrop}')"></div>`:`<div class="ms-field"></div>`;
  const hasOwn=!!(store.backdrops&&store.backdrops[gameKey(aKey,xKey)]);
  const rm=hasOwn?`<div class="sh-cam rm" onclick="event.stopPropagation();removeGameBackdrop('${aKey}','${xKey}')" title="Remove background">${ICON_X}</div>`:'';
  const phase=opts.phase||(opts.live?'live':null);
  const pill = phase==='pre'?`<div class="ms-live pre"><span class="dot"></span>PREGAME</div>`
             : phase==='final'?`<div class="ms-live final">FINAL</div>`
             : phase==='live'?`<div class="ms-live"><span class="pulse"></span>LIVE</div>`:'';
  const proj=(ap!=null&&xp!=null)?`<div class="sh-proj">PROJ <b>${ap.toFixed(1)}</b> – <b>${xp.toFixed(1)}</b></div>`:'';
  const logo=(t)=>t.logo
    ? `<div class="sh-logo bare"><img src="${t.logo}" alt=""></div>`
    : `<div class="sh-logo" style="background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${t.mono}</div>`;
  const rwId=opts.rewind||null;
  const wc=rwId?` data-rw="${rwId}" onclick="event.stopPropagation();toggleRewind('${rwId}')"`:'';
  const tw=rwId?' tapw':'';
  const cv=rwId?`<span class="cv">▾</span>`:'';
  return `<div class="mstage" style="--ac:${a.c};--xc:${x.c}">
    ${bg}<div class="ms-scrim"></div>
    <div class="sh-glowL"></div><div class="sh-glowR"></div>
    <div class="ms-chrome">
      <div class="ms-ic" onclick="toast('League messages')" style="position:relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.5 8.5 0 1 1 21 11.5Z"/></svg>
        <span class="ms-badge">2</span>
      </div>
      <div class="ms-title" onclick="toast('Switch league')">
        <svg class="shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>
        <div><div class="nm">City Boys Dynasty <span class="chev">▾</span></div><div class="wk">WEEK ${S.week}</div></div>
      </div>
      <div class="ms-ic" onclick="toggleDrawer()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></div>
    </div>
    <div class="ms-nav">
      ${TABS().map(t=>t.k==='matchup'
        ?`<div class="ms-tab on">${t.lb}</div>`
        :`<div class="ms-tab" onclick="showTab('${t.k}')">${t.lb}</div>`).join('')}
    </div>
    <div class="ms-tools">${pill}<div style="flex:1"></div>${rm}<div class="sh-cam" onclick="pickGameBackdrop('${aKey}','${xKey}')" title="Change background">${ICON_CAM}</div></div>
    <div class="ms-arena">
      <div class="ms-side L">
        ${logo(a)}
        <div class="sh-tn tf-${aKey}" style="color:${a.c}" onclick="openTeam('${aKey}')">${a.n}</div>
        ${recHTML(aKey)}
        <div class="sh-pct${tw}" style="color:${pctColor(aw,xw)}"${wc}>${aw}%</div>
      </div>
      <div class="ms-center" data-vs>
        ${leagueLogoHTML()}
        <div class="sh-vs">VS</div>
        <div class="sh-score">${as.toFixed(1)}<span>–</span>${xs.toFixed(1)}</div>
        ${proj}
      </div>
      <div class="ms-side R">
        ${logo(x)}
        <div class="sh-tn tf-${xKey}" style="color:${x.c}" onclick="openTeam('${xKey}')">${x.n}</div>
        ${recHTML(xKey)}
        <div class="sh-pct${tw}" style="color:${pctColor(xw,aw)}"${wc}>${xw}%</div>
      </div>
    </div>
    <div class="sh-winbar${tw}" style="margin:2px 16px 14px"${wc}><i style="width:${aw}%"></i>${cv}</div>
  </div>`;
}
// stadium hero used by All Matchups list + detail view (compact battling-logos card)
export function stadiumHeroHTML(aKey,xKey,as,xs,aw,xw,ap,xp,opts){
  opts=opts||{};
  const a=T[aKey],x=T[xKey];
  const bdrop=backdropFor(aKey,xKey);
  const bg=bdrop
    ? `<div class="sh-bg" style="background-image:url('${bdrop}')"></div><div class="sh-scrim"></div>`
    : `<div class="sh-field"></div>`;
  let cam='';
  if(opts.editBackdrop){
    const hasOwn=!!(store.backdrops&&store.backdrops[gameKey(aKey,xKey)]);
    const rm=hasOwn?`<div class="sh-cam rm" onclick="event.stopPropagation();removeGameBackdrop('${aKey}','${xKey}')" title="Remove background">${ICON_X}</div>`:'';
    cam=`<div class="sh-cams">${rm}<div class="sh-cam" onclick="event.stopPropagation();pickGameBackdrop('${aKey}','${xKey}')" title="Change background">${ICON_CAM}</div></div>`;
  }
  const status=opts.status?`<div class="sh-status ${opts.status.cls}">${opts.status.cls==='live'?'<span class="pulse" style="width:6px;height:6px"></span>':''}${opts.status.txt}</div>`:'';
  const proj=(ap!=null&&xp!=null)?`<div class="sh-proj">PROJ <b>${ap.toFixed(1)}</b> – <b>${xp.toFixed(1)}</b></div>`:'';
  const logo=(t)=>t.logo
    ? `<div class="sh-logo bare"><img src="${t.logo}" alt=""></div>`
    : `<div class="sh-logo" style="background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${t.mono}</div>`;
  const nameClick=(k)=>`onclick="event.stopPropagation();openTeam('${k}')"`;
  const rwId=opts.rewind||null;
  const wc=rwId?` data-rw="${rwId}" onclick="event.stopPropagation();toggleRewind('${rwId}')"`:'';
  const tw=rwId?' tapw':'';
  const cv=rwId?`<span class="cv">▾</span>`:'';
  return `<div class="sh${opts.compact?' compact':''}" style="--ac:${a.c};--xc:${x.c}">
    ${bg}
    <div class="sh-glowL"></div><div class="sh-glowR"></div>
    ${status}${cam}
    <div class="sh-arena">
      <div class="sh-side L">
        ${logo(a)}
        <div class="sh-tn tf-${aKey}" style="color:${a.c}" ${nameClick(aKey)}>${a.n}</div>
        ${recHTML(aKey)}
        <div class="sh-pct${tw}" style="color:${pctColor(aw,xw)}"${wc}>${aw}%</div>
      </div>
      <div class="sh-center" ${opts.tapHint?'data-vs':''}>
        ${leagueLogoHTML()}
        <div class="sh-vs">VS</div>
        <div class="sh-score">${as.toFixed(1)}<span>–</span>${xs.toFixed(1)}</div>
        ${proj}
      </div>
      <div class="sh-side R">
        ${logo(x)}
        <div class="sh-tn tf-${xKey}" style="color:${x.c}" ${nameClick(xKey)}>${x.n}</div>
        ${recHTML(xKey)}
        <div class="sh-pct${tw}" style="color:${pctColor(xw,aw)}"${wc}>${xw}%</div>
      </div>
    </div>
    <div class="sh-winbar${tw}"${wc}><i style="width:${aw}%"></i>${cv}</div>
  </div>`;
}
// per-game backdrop (only affects this matchup)
export let backdropTargetKey=null;
export function pickGameBackdrop(a,x){backdropTargetKey=gameKey(a,x);document.getElementById('backdropInput').click();}
export function onBackdrop(input){
  const f=input.files&&input.files[0];if(!f||!backdropTargetKey)return;
  processImage(f,900,'image/jpeg',0.8,(url)=>{store.backdrops[backdropTargetKey]=url;saveStore();refreshMatchups();});
}
export function removeGameBackdrop(a,x){const k=gameKey(a,x);if(store.backdrops)delete store.backdrops[k];saveStore();refreshMatchups();}
// commissioner: one backdrop for every matchup at once (Settings). These reach
// every member's matchup, so they are gated at the source as well as hidden.
export function pickGlobalBackdrop(){
  if(!isCommish())return;
  document.getElementById('globalBackdropInput').click();
}
export function onGlobalBackdrop(input){
  const f=input.files&&input.files[0];if(!f||!isCommish())return;
  processImage(f,900,'image/jpeg',0.8,(url)=>{store.globalBackdrop=url;store.backdrops={};saveStore();refreshMatchups();renderSettings();});
}
export function clearAllBackdrops(){
  if(!isCommish())return;
  delete store.globalBackdrop;store.backdrops={};saveStore();refreshMatchups();renderSettings();
}
// commissioner: the league logo drawn at the centre of every matchup. PNG, so an
// uploaded crest keeps its transparency over the backdrop.
export function pickLeagueLogo(){
  if(!isCommish())return;
  document.getElementById('leagueLogoInput').click();
}
export function onLeagueLogo(input){
  const f=input.files&&input.files[0];if(!f||!isCommish())return;
  processImage(f,256,'image/png',0.92,(url)=>{LG().logo=url;saveStore();refreshMatchups();renderSettings();});
}
export function clearLeagueLogo(){
  if(!isCommish())return;
  LG().logo=null;saveStore();refreshMatchups();renderSettings();
}
export function refreshMatchups(){renderLeagueBody();renderUserMatchup();}
