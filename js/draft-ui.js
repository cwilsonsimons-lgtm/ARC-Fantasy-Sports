import { S } from './state.js';
import { slotAllows } from './clock.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { byeFor } from './data/nfl-index.js';
import { MY_TEAM, T } from './data/teams.js';
import { curLeague } from './data/league-config.js';
import { draftBoard, draftDone, draftLocked, draftOrderL, draftPicks, draftRoundsL, draftTotalL, pickAt, myTurn, onClockIdx, pickMeta, teamRosterIds } from './draft.js';
import { pickBadges, reactionTally, reactionsOpen, seedReactions, draftCfg } from './draft-meta.js';
import { bindDraftTiles, startDraftClock, stopDraftClock } from './draft-room.js';
import { preDraft, showTab } from './nav.js';
import { PANEL_CAP, escAttr, escHtml, matchQ, pillsHTML } from './panel.js';
import { faceInner, posMatch } from './player.js';
import { markInner } from './store.js';
import { esc } from './team.js';

// ---------- DRAFT ROOM UI ----------
export let draftPos='ALL', draftQ='';
export function openDraft(){showTab('draft');}
export function setDraftPos(pl){draftPos=pl;document.querySelectorAll('#draftBody .pillrow .pill').forEach(el=>el.classList.toggle('on',el.textContent.trim()===pl));paintDraftBoard();}
export function onDraftSearch(v){draftQ=v;const c=document.querySelector('#draftBody .psearch .clr');if(c)c.classList.toggle('on',!!v);paintDraftBoard();}
export function clearDraftSearch(){draftQ='';const i=document.getElementById('draftSearch');if(i){i.value='';i.focus();}onDraftSearch('');}
export function paintDraftBoard(){const el=document.getElementById('draftList');if(el)el.innerHTML=draftBoardHTML();}


// ---------- DRAFT BOARD GRID ----------
//
// Sleeper's shape on purpose: owners across, rounds down, snaking, whole draft
// visible. The additions are metadata, not layout - badges in the corner and
// league reactions along the bottom edge, both sized to stay under the pick.

const REACT_SHOWN = 3;   // more than this and the tile stops reading as a pick

function badgeStrip(rec, overall){
  const b = pickBadges(rec, overall);
  if(!b.length) return '';
  return `<span class="dg-badges">${b.map(x =>
    `<i class="dg-b ${x.k}" title="${esc(x.label)}">${x.icon}</i>`).join('')}</span>`;
}

function reactionStrip(rec, overall){
  const tally = reactionTally(rec);
  if(!tally.length) return '';
  const shown = tally.slice(0, REACT_SHOWN);
  const more = tally.length - shown.length;
  return `<span class="dg-react" onclick="event.stopPropagation();openReactionBreakdown(${overall})">
    ${shown.map(([e,n]) => `<i>${e}${n>1?`<b>${n}</b>`:''}</i>`).join('')}
    ${more?`<i class="more">+${more}</i>`:''}</span>`;
}

export function draftGridHTML(){
  const ORD=draftOrderL();
  const picks = draftPicks(), onClock = onClockIdx(), n = ORD.length;
  const clockTeam = draftDone() ? null : pickMeta(onClock).team;

  const head = `<div class="dg-row dg-head">
    <div class="dg-rd"></div>
    ${ORD.map(k=>{
      const t=T[k], live = k===clockTeam;
      return `<div class="dg-th${k===MY_TEAM?' me':''}${live?' clock':''}">
        ${live?`<div class="dg-timer" id="dgTimer">${draftCfg().clutchSec>0?'':''}<span>1:30</span></div>`:''}
        <div class="dg-crest" style="background:${t.bg};color:${t.c}">${markInner(t)}</div>
        <div class="dg-mgr">${escHtml(t.mgr)}</div>
      </div>`;
    }).join('')}
  </div>`;

  const rows = Array.from({length:draftRoundsL()},(_,r)=>{
    const down = r%2===0;                       // snake direction for this round
    const cells = Array.from({length:n},(_,c)=>{
      const overall = r*n + (down ? c : n-1-c);
      const rec = picks[overall];
      const team = ORD[c];
      const label = `${r+1}.${(overall%n)+1}`;
      const live = !draftDone() && overall===onClock;
      if(!rec){
        return `<div class="dg-cell empty${live?' clock':''}${team===clockTeam?' col':''}">
          <span class="pk">${label}</span></div>`;
      }
      seedReactions(rec, overall);
      const p = NFL_BY_ID[rec.id];
      const parts = (p.full||p.n).split(' ');
      const first = parts.shift(), last = parts.join(' ');
      const open = reactionsOpen(overall, picks.length);
      return `<div class="dg-cell ${p.pos}${team===clockTeam?' col':''}" data-pick="${overall}"
          onclick="openPickDetail(${overall})">
        <div class="dg-m"><span>${p.pos} · ${p.tm}</span><span class="pk">${label}</span></div>
        <div class="dg-f">${esc(first)}</div>
        <div class="dg-l">${esc(last)}</div>
        ${badgeStrip(rec, overall)}
        ${reactionStrip(rec, overall)}
        ${open?'<span class="dg-open" title="Reactions still open"></span>':''}
      </div>`;
    }).join('');
    return `<div class="dg-row"><div class="dg-rd">${r+1}</div>${cells}</div>`;
  }).join('');

  return `<div class="dg-scroll"><div class="dg">${head}${rows}</div></div>
    <div class="dg-note">Tap a pick for detail &middot; hold to react &middot;
      reactions lock when the next pick lands</div>`;
}

export function draftBoardHTML(){
  const mine=myTurn();
  const list=draftBoard().filter(p=>posMatch(p.pos,draftPos)&&matchQ(p,draftQ));
  if(!list.length)return `<div class="empty">No players left matching that</div>`;
  return list.slice(0,PANEL_CAP).map(p=>`<div class="dr-row" onclick="openPlayer('${esc(p.id)}')">
    <span class="dr-adp">${p.adp}</span>
    <span class="dr-face">${faceInner(p.id)}</span>
    <div class="dr-info"><div class="dr-nm">${p.full}</div>
      <div class="dr-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm} · ${p.sproj.toFixed(0)} proj pts</div></div>
    <span class="dr-pj">${p.proj.toFixed(1)}</span>
    <span class="dr-take${mine?'':' off'}" onclick="event.stopPropagation();draftPlayer('${p.id}')">+</span>
  </div>`).join('');
}
export function myDraftSlotsHTML(){
  const ids=teamRosterIds(MY_TEAM).map(id=>NFL_BY_ID[id]).filter(Boolean).sort((a,b)=>b.sproj-a.sproj);
  const used=new Set(),rows=[];
  S.lineupSlots.forEach(sl=>{
    const p=ids.find(q=>!used.has(q.id)&&slotAllows(sl,q.pos));
    if(p)used.add(p.id);
    rows.push(`<div class="dr-slot"><span class="sl">${sl}</span>
      <span class="pn${p?'':' e'}">${p?p.full:'Empty'}</span>
      <span class="dr-mt">${p?p.pos+' · '+p.tm:''}</span></div>`);
  });
  ids.filter(q=>!used.has(q.id)).forEach(p=>rows.push(`<div class="dr-slot"><span class="sl">BN</span>
      <span class="pn">${p.full}</span><span class="dr-mt">${p.pos} · ${p.tm}</span></div>`));
  return rows.join('');
}
export function recentPicksHTML(){
  const ps=draftPicks();
  if(!ps.length)return `<div class="empty">No picks yet</div>`;
  return ps.slice(-24).reverse().map((rec,k)=>{
    const i=ps.length-1-k,m=pickMeta(i),id=rec&&rec.id,p=NFL_BY_ID[id],t=T[m.team];
    return `<div class="dr-pick${m.team===MY_TEAM?' me':''}">
      <span class="no">${m.round}.${String(m.pick).padStart(2,'0')}</span>
      <span class="pn">${p?esc(p.full):''} <span class="dr-mt">${p?p.pos+' · '+p.tm:''}</span></span>
      <span class="tn tf-${m.team}" style="color:${t.c}">${escHtml(t.n)}</span></div>`;
  }).join('');
}
// A created league can't draft until every seat is filled, so its Draft tab is
// a waiting room: who's in, what's configured, and where to change it.
export function draftWaitingHTML(c){
  const L=c.league,joined=Object.keys(c.teams||{}).length,need=Math.max(0,+L.teams-joined);
  const when=L.draftDate?`${L.draftDate} · ${L.draftTime||''}`:'Not scheduled';
  const typeLb={snake:'Snake',linear:'Linear',auction:'Auction'}[L.draftType]||'Snake';
  const poolLb={all:'All players',rookies:'Rookies only',vets:'Veterans only'}[L.draftPool]||'All players';
  const members=Object.keys(c.teams||{}).map(k=>{
    const t=T[k]||c.teams[k];
    return `<div class="dr-wait-m">
      <span class="dg-crest" style="background:${t.bg};color:${t.c}">${markInner(t)}</span>
      <span class="nm tf-${k}">${escHtml(t.n)}</span><span class="mg">${escHtml(t.mgr)}</span></div>`;
  }).join('');
  return `
    <div class="dr-wait">
      <div class="dr-wait-h">Draft Room</div>
      <div class="dr-wait-s">${joined} of ${L.teams} managers joined · ${need} seat${need===1?'':'s'} open</div>
      <div class="dr-wait-bar"><i style="width:${Math.round(joined/Math.max(1,+L.teams)*100)}%"></i></div>
      <div class="dr-wait-note">The draft opens once every team has joined. Manager invites aren't wired up in this prototype yet.</div>
    </div>
    <div class="dr-sec">Joined <span class="c">${joined}/${L.teams}</span></div>
    <div class="dr-wait-list">${members}</div>
    <div class="dr-sec">Draft Settings</div>
    <div class="dr-wait-cfg">
      ${[['Scheduled',when],['Type',typeLb],['Player pool',poolLb],['Rounds',draftRoundsL()],
         ['Time per pick',(+L.draftPickSec>=3600?(L.draftPickSec/3600)+' hr':(+L.draftPickSec>=60?(L.draftPickSec/60)+' min':L.draftPickSec+' sec'))]]
        .map(r=>`<div class="dr-wait-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}
    </div>
    <div class="dr-acts" style="margin-top:14px"><div class="dr-btn go" onclick="openSettings();setSetTab('draft')">Draft settings</div></div>`;
}
export function renderDraft(){
  const el=document.getElementById('draftBody');if(!el)return;
  const bk=document.getElementById('draftBack');
  if(bk)bk.innerHTML=preDraft()?'':`<div class="back" onclick="showTab('matchup')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      Matchup</div>`;
  const c=curLeague();
  if(c&&draftLocked()){
    if(bk)bk.innerHTML='';
    el.innerHTML=draftWaitingHTML(c);
    stopDraftClock();
    return;
  }
  const done=draftDone(),i=onClockIdx(),mine=myTurn();
  let head;
  if(done){
    head=`<div class="dr-done">Draft complete · ${draftTotalL()} picks</div>
      <div class="dr-acts"><div class="dr-btn warn" onclick="resetDraft()">Reset draft</div></div>`;
  } else {
    const m=pickMeta(i),t=T[m.team];
    head=`<div class="dr-clock${mine?' mine':''}">
      <div class="rd">ROUND ${m.round} OF ${draftRoundsL()} · PICK ${m.pick} · #${i+1} OVERALL</div>
      <div class="who">
        <div class="dr-crest" style="background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${markInner(t)}</div>
        <div><div class="nm tf-${m.team}" style="color:${t.c}">${escHtml(t.n)}</div><div class="sub">${mine?'You are on the clock':escHtml(t.mgr)+' is on the clock'}</div></div>
      </div>
      <div class="dr-acts">
        ${mine?'':`<div class="dr-btn go" onclick="simToMyPick()">Sim to my pick</div>`}
        <div class="dr-btn" onclick="autoDraftAll()">Auto-draft rest</div>
        <div class="dr-btn warn" onclick="resetDraft()">Reset</div>
      </div></div>`;
  }
  el.innerHTML=head+
    `<div class="dr-sec">Draft Board <span class="c">${draftPicks().length}/${draftTotalL()} picks</span></div>
     ${draftGridHTML()}
     <div class="dr-sec">My Roster <span class="c">${teamRosterIds(MY_TEAM).length}/${draftRoundsL()}</span></div>
     <div>${myDraftSlotsHTML()}</div>
     <div class="dr-sec">Available <span class="c">${draftBoard().length} left</span></div>
     <div class="psearch">
       <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
       <input id="draftSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
         placeholder="Search players" value="${escAttr(draftQ)}" oninput="onDraftSearch(this.value)">
       <span class="clr${draftQ?' on':''}" onclick="clearDraftSearch()">✕</span>
     </div>
     ${pillsHTML(draftPos,'setDraftPos')}
     <div id="draftList">${draftBoardHTML()}</div>
     <div class="dr-sec">Recent Picks <span class="c">${draftPicks().length}/${draftTotalL()}</span></div>
     <div>${recentPicksHTML()}</div>`;
  // the grid is replaced wholesale each render, so gestures and the clock rebind
  bindDraftTiles();
  startDraftClock();
}
