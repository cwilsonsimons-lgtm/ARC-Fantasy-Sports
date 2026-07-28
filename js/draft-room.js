// Draft room interactions: the pick detail modal, the reaction sheet, the
// reaction breakdown, and the on-clock timer.
//
// Tap a tile for detail, hold it to react. Holding rather than tapping keeps the
// draft workflow intact - the common action stays a single tap, and reacting is
// a deliberate gesture that cannot fire while you are scanning the board.
import { T, MY_TEAM } from './data/teams.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { DRAFT_ORDER, DRAFT_ROUNDS } from './clock.js';
import { draftPicks, pickAt, pickMeta, onClockIdx, draftDone } from './draft.js';
import { REACTIONS, pickBadges, reactionTally, reactionsOpen, setReaction,
         draftCfg } from './draft-meta.js';
import { esc } from './team.js';
import { escHtml } from './panel.js';
import { faceInner } from './player.js';
import { toast } from './nav.js';

const PICK_SECONDS = 90;

function sheet(title, body){
  document.getElementById('drSheetTitle').innerHTML = title;
  document.getElementById('drSheetBody').innerHTML = body;
  document.getElementById('drSheetScrim').classList.add('show');
  document.getElementById('drSheet').classList.add('show');
}
export function closeDraftSheet(){
  document.getElementById('drSheetScrim').classList.remove('show');
  document.getElementById('drSheet').classList.remove('show');
}

function ownerOf(overall){ return pickMeta(overall).team; }

// ---------------------------------------------------------------- detail
export function openPickDetail(overall){
  const rec = pickAt(overall);
  if(!rec) return;
  const p = NFL_BY_ID[rec.id], m = pickMeta(overall), t = T[m.team];
  const badges = pickBadges(rec, overall);
  const tally = reactionTally(rec);
  const when = rec.ts ? new Date(rec.ts).toLocaleString(undefined,
    { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—';

  sheet(escHtml(p.full || p.n), `
    <div class="dp-top">
      <div class="dp-face">${faceInner(p.id)}</div>
      <div class="dp-id">
        <div class="dp-pos"><span class="pos ${p.pos}">${p.pos}</span> ${esc(p.tm)}
          &middot; #${esc(p.num||'')}</div>
        <div class="dp-proj">${p.sproj.toFixed(0)} proj pts &middot; ADP ${p.adp<999?p.adp:'—'}</div>
      </div>
    </div>

    <div class="dp-grid">
      <div><span class="k">DRAFTED BY</span><span class="v tf-${m.team}">${escHtml(t.n)}</span></div>
      <div><span class="k">ROUND</span><span class="v">${m.round}</span></div>
      <div><span class="k">PICK</span><span class="v">${m.round}.${m.pick}</span></div>
      <div><span class="k">OVERALL</span><span class="v">#${overall+1}</span></div>
      <div><span class="k">WHEN</span><span class="v sm">${esc(when)}</span></div>
      <div><span class="k">ON CLOCK</span><span class="v sm">${rec.auto?'Auto'
        :(rec.ms!=null?(rec.ms/1000).toFixed(1)+'s':'—')}</span></div>
    </div>

    ${badges.length?`<h4>BADGES</h4><div class="dp-badges">${badges.map(b=>
      `<span class="dp-badge ${b.k}">${b.icon} ${esc(b.label)}</span>`).join('')}</div>`:''}

    <h4>LEAGUE REACTIONS</h4>
    ${tally.length?`<div class="dp-reacts">${tally.map(([e,n,teams])=>
      `<div class="dp-rr"><span class="e">${e}</span><span class="who">${
        teams.map(k=>escHtml((T[k]||{}).mgr||k)).join(', ')}</span><b>${n}</b></div>`).join('')}</div>`
      : `<div class="dp-none">No reactions on this pick</div>`}

    <div class="dp-acts">
      <div class="dr-btn" onclick="closeDraftSheet();openPlayer('${esc(p.id)}')">Player profile</div>
      <div class="dr-btn" onclick="toast('Trade history — not in this prototype')">Trade history</div>
      <div class="dr-btn" onclick="toast('Fantasy history — not in this prototype')">Fantasy history</div>
    </div>
    ${reactionsOpen(overall, draftPicks().length)
      ? `<div class="dr-btn go" style="margin-top:10px" onclick="openReactionSheet(${overall})">React to this pick</div>`
      : `<div class="dp-locked">Reactions locked when the next pick landed</div>`}`);
}

// ---------------------------------------------------------------- react
export function openReactionSheet(overall){
  const rec = pickAt(overall);
  if(!rec) return;
  if(!reactionsOpen(overall, draftPicks().length)){
    toast('Reactions locked — the next pick already landed');
    return;
  }
  const p = NFL_BY_ID[rec.id], mine = (rec.react||{})[MY_TEAM];
  sheet('React to ' + escHtml(p.full || p.n), `
    <div class="rx-grid">
      ${REACTIONS.map(([e,label])=>`<div class="rx${mine===e?' on':''}"
        onclick="pickReaction(${overall},'${e}')">
        <span class="e">${e}</span><span class="l">${esc(label)}</span></div>`).join('')}
    </div>
    <div class="rx-note">One reaction each. Change it until the next pick lands —
      after that it is part of the draft forever.</div>`);
}

export function pickReaction(overall, emoji){
  const rec = pickAt(overall);
  if(!rec) return;
  if(!reactionsOpen(overall, draftPicks().length)){ toast('Reactions locked'); return; }
  setReaction(rec, MY_TEAM, emoji);
  closeDraftSheet();
  window.renderDraft && window.renderDraft();
  toast((rec.react||{})[MY_TEAM] ? 'Reaction saved' : 'Reaction removed');
}

export function openReactionBreakdown(overall){
  const rec = pickAt(overall);
  if(!rec) return;
  const p = NFL_BY_ID[rec.id], tally = reactionTally(rec);
  sheet(escHtml(p.full || p.n), `
    <div class="dp-reacts">${tally.map(([e,n,teams])=>teams.map(k=>
      `<div class="dp-rr"><span class="e">${e}</span>
       <span class="who">${escHtml((T[k]||{}).mgr||k)}</span></div>`).join('')).join('')}</div>
    ${reactionsOpen(overall, draftPicks().length)
      ? `<div class="dr-btn go" style="margin-top:12px" onclick="openReactionSheet(${overall})">Add or change yours</div>`
      : `<div class="dp-locked">Locked — this is how draft night saw it</div>`}`);
}

// ---------------------------------------------------------------- gestures
// Rebound after every render, since the grid is replaced wholesale.
export function bindDraftTiles(){
  document.querySelectorAll('.dg-cell[data-pick]').forEach(el=>{
    let timer = null, held = false;
    const overall = +el.dataset.pick;
    const start = () => { held = false;
      timer = setTimeout(()=>{ held = true; el.classList.add('held');
        openReactionSheet(overall); }, 420); };
    const cancel = () => { clearTimeout(timer); el.classList.remove('held'); };
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('touchstart', start, { passive:true });
    el.addEventListener('touchmove', cancel, { passive:true });   // a drag is a scroll
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    // swallow the tap that follows a long press, so detail does not also open
    el.addEventListener('click', e => { if(held){ e.stopPropagation(); e.preventDefault(); held=false; } }, true);
  });
}

// ---------------------------------------------------------------- timer
let tick = null, deadline = 0;
export function startDraftClock(){
  stopDraftClock();
  if(draftDone()) return;
  deadline = Date.now() + PICK_SECONDS * 1000;
  paintClock();
  tick = setInterval(paintClock, 1000);
}
export function stopDraftClock(){ if(tick){ clearInterval(tick); tick = null; } }
function paintClock(){
  const el = document.getElementById('dgTimer');
  if(!el){ stopDraftClock(); return; }
  const left = Math.max(0, Math.round((deadline - Date.now())/1000));
  const s = String(left % 60).padStart(2,'0');
  el.innerHTML = `<span>${Math.floor(left/60)}:${s}</span>`;
  el.classList.toggle('low', left <= 10);
}
