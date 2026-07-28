import { S } from './state.js';
import { DRAFT_ROUNDS, DRAFT_TOTAL, slotAllows } from './clock.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { MY_TEAM, T } from './data/teams.js';
import { draftBoard, draftDone, draftPicks, myTurn, onClockIdx, pickMeta, teamRosterIds } from './draft.js';
import { preDraft, showTab } from './nav.js';
import { PANEL_CAP, escAttr, matchQ, pillsHTML } from './panel.js';
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
  return ps.slice(-24).reverse().map((id,k)=>{
    const i=ps.length-1-k,m=pickMeta(i),p=NFL_BY_ID[id],t=T[m.team];
    return `<div class="dr-pick${m.team===MY_TEAM?' me':''}">
      <span class="no">${m.round}.${String(m.pick).padStart(2,'0')}</span>
      <span class="pn">${p?p.full:id} <span class="dr-mt">${p?p.pos+' · '+p.tm:''}</span></span>
      <span class="tn tf-${m.team}" style="color:${t.c}">${t.n}</span></div>`;
  }).join('');
}
export function renderDraft(){
  const el=document.getElementById('draftBody');if(!el)return;
  const bk=document.getElementById('draftBack');
  if(bk)bk.innerHTML=preDraft()?'':`<div class="back" onclick="showTab('matchup')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      Matchup</div>`;
  const done=draftDone(),i=onClockIdx(),mine=myTurn();
  let head;
  if(done){
    head=`<div class="dr-done">Draft complete · ${DRAFT_TOTAL} picks</div>
      <div class="dr-acts"><div class="dr-btn warn" onclick="resetDraft()">Reset draft</div></div>`;
  } else {
    const m=pickMeta(i),t=T[m.team];
    head=`<div class="dr-clock${mine?' mine':''}">
      <div class="rd">ROUND ${m.round} OF ${DRAFT_ROUNDS} · PICK ${m.pick} · #${i+1} OVERALL</div>
      <div class="who">
        <div class="dr-crest" style="background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${markInner(t)}</div>
        <div><div class="nm tf-${m.team}" style="color:${t.c}">${t.n}</div><div class="sub">${mine?'You are on the clock':t.mgr+' is on the clock'}</div></div>
      </div>
      <div class="dr-acts">
        ${mine?'':`<div class="dr-btn go" onclick="simToMyPick()">Sim to my pick</div>`}
        <div class="dr-btn" onclick="autoDraftAll()">Auto-draft rest</div>
        <div class="dr-btn warn" onclick="resetDraft()">Reset</div>
      </div></div>`;
  }
  el.innerHTML=head+
    `<div class="dr-sec">My Roster <span class="c">${teamRosterIds(MY_TEAM).length}/${DRAFT_ROUNDS}</span></div>
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
     <div class="dr-sec">Recent Picks <span class="c">${draftPicks().length}/${DRAFT_TOTAL}</span></div>
     <div>${recentPicksHTML()}</div>`;
}
