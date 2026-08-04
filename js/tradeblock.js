import { MY_TEAM, T } from './data/teams.js';
import { toast } from './nav.js';
import { escAttr, escHtml } from './panel.js';
import { faceInner, findPlayer, renderPlayer } from './player.js';
import { saveStore, store } from './store.js';
import { esc } from './team.js';

// ===== TRADE BLOCK =====
//
// Listing a player and saying what you want back are one action, not two. The
// "Looking For" sheet opens the moment a player is added, because that is the
// only moment the owner is actually thinking about the trade - asking them to
// go and find a second screen afterwards is how trade blocks end up as a wall
// of names with no context. It can be skipped, and the answer is editable
// afterwards from the player's card.
//
// store.tradeBlock: { [playerKey]: { want, team, ts } }

export const LOOKING_FOR=['Young WR','RB Depth','2028 1st','Veteran QB','Best Offer'];

export function tradeBlock(){store.tradeBlock=store.tradeBlock||{};return store.tradeBlock;}
export function blockEntry(key){return tradeBlock()[key]||null;}
export function onBlock(key){return !!blockEntry(key);}
export function blockKeys(){return Object.keys(tradeBlock());}
/** What the owner is after, in the words they typed. */
export function blockWant(key){
  const e=blockEntry(key);
  return (e&&e.want)||'';
}

let pendingKey=null;   // the player the open sheet belongs to

/** Step one of the flow: the player lands on the block, then we ask what for. */
export function addToTradeBlock(key){
  if(!key)return;
  const b=tradeBlock();
  if(!b[key])b[key]={want:'',team:MY_TEAM,ts:Date.now()};
  saveStore();
  openLookingFor(key);
}
export function openLookingFor(key){
  pendingKey=key;
  const p=findPlayer(key),name=p.full&&p.full!==p.n?p.full:(p.n||key);
  const cur=blockWant(key);
  document.getElementById('tbTitle').textContent='Looking For';
  document.getElementById('tbBody').innerHTML=`
    <div class="tb-sub"><b>${escHtml(name)}</b> is on the trade block. What are you looking for?</div>
    <div class="tb-chips">${LOOKING_FOR.map(v=>
      `<div class="tb-chip${v===cur?' on':''}" onclick="pickLookingFor('${esc(v)}')">${escHtml(v)}</div>`).join('')}</div>
    <input id="tbInput" class="tb-input" maxlength="48" value="${escAttr(cur)}"
      placeholder="Or type it — e.g. 2027 2nd + WR3" onkeydown="if(event.key==='Enter')saveLookingFor()">
    <div class="tb-btns">
      <div class="tb-btn" onclick="skipLookingFor()">Skip for now</div>
      <div class="tb-btn go" onclick="saveLookingFor()">Save</div>
    </div>
    <div class="tb-note">Whatever you write shows up whenever anyone taps this player.</div>`;
  document.getElementById('tbScrim').classList.add('show');
  document.getElementById('tbSheet').classList.add('show');
}
export function pickLookingFor(v){
  const i=document.getElementById('tbInput');
  if(i)i.value=v;
  document.querySelectorAll('#tbBody .tb-chip').forEach(el=>el.classList.toggle('on',el.textContent.trim()===v));
}
export function saveLookingFor(){
  const key=pendingKey;if(!key)return;
  const i=document.getElementById('tbInput');
  const want=((i&&i.value)||'').trim();
  const e=tradeBlock()[key];
  if(e){e.want=want;e.ts=Date.now();saveStore();}
  closeTradeBlockSheet();
  refreshBlockViews(key);
  toast(want?`Listed — looking for ${want}`:'Added to the trade block');
}
/** Skipping still lists the player; it just leaves the ask open. */
export function skipLookingFor(){
  const key=pendingKey;
  closeTradeBlockSheet();
  refreshBlockViews(key);
  toast('Added to the trade block');
}
export function closeTradeBlockSheet(){
  pendingKey=null;
  document.getElementById('tbScrim').classList.remove('show');
  document.getElementById('tbSheet').classList.remove('show');
}
export function removeFromBlock(key){
  delete tradeBlock()[key];saveStore();
  refreshBlockViews(key);
  toast('Removed from the trade block');
}
/** Silent version, for when a player leaves the roster: you cannot shop someone
 *  you no longer own, and the drop already has its own toast. */
export function dropFromBlock(key){
  if(!key||!tradeBlock()[key])return;
  delete tradeBlock()[key];saveStore();
}
function refreshBlockViews(key){
  const pv=document.querySelector('.view[data-view="player"]');
  if(pv&&pv.classList.contains('on')&&key)renderPlayer(key);
  const rail=document.querySelector('.rail-item.on');
  if(rail&&rail.dataset.rail==='trades')renderTradeBlockPanel();
}

// ---- what a player's card shows once they are listed ----
export function tradeBlockCardHTML(key,mine){
  if(!onBlock(key))
    return mine?`<div class="pc-block-add" onclick="addToTradeBlock('${esc(key)}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg>
      Add to Trade Block</div>`:'';
  const want=blockWant(key);
  const e=blockEntry(key),t=T[(e&&e.team)||MY_TEAM]||T[MY_TEAM];
  return `<div class="pc-block">
    <div class="pc-block-hd">On the trade block · ${escHtml(t.mgr)}</div>
    <div class="pc-block-want">${want
      ? `<span class="k">Looking for</span> ${escHtml(want)}`
      : `<span class="k">Looking for</span> <i>Open to offers</i>`}</div>
    ${mine?`<div class="pc-block-acts">
      <span onclick="openLookingFor('${esc(key)}')">${want?'Edit':'Add'} what you want</span>
      <span onclick="removeFromBlock('${esc(key)}')">Remove</span>
    </div>`:''}
  </div>`;
}

// ---- the Trades rail ----
export function tradeBlockListHTML(){
  const keys=blockKeys();
  if(!keys.length)
    return `<div class="empty">Nobody is on the block yet.<br>
      Open a player on your roster and tap <b style="color:#93A0B0">Add to Trade Block</b>.</div>`;
  return keys.map(key=>{
    const p=findPlayer(key),want=blockWant(key);
    return `<div class="tb-row" onclick="openPlayer('${esc(key)}')">
      <span class="tb-face">${faceInner(key)}</span>
      <div class="tb-info">
        <div class="tb-nm">${escHtml(p.full&&p.full!==p.n?p.full:(p.n||key))}</div>
        <div class="tb-mt"><span class="pos ${p.pos}">${p.pos||'—'}</span> · ${escHtml(p.tm||'')}</div>
      </div>
      <div class="tb-want">${want?escHtml(want):'<i>Open to offers</i>'}</div>
    </div>`;
  }).join('');
}
export function renderTradeBlockPanel(){
  const el=document.getElementById('panel');if(!el)return;
  el.innerHTML=`<div class="panel-hd"><span class="d"></span>Trade Block
      <span class="wk">· ${blockKeys().length} listed</span></div>
    <div id="panelList">${tradeBlockListHTML()}</div>`;
}
