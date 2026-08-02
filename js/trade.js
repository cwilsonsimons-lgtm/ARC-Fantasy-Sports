import { MY_TEAM, T } from './data/teams.js';
import { showView, toggleDrawer } from './nav.js';
import { escHtml } from './panel.js';
import { faceInner } from './player.js';
import { rosterFor } from './team.js';
import { saveStore, store } from './store.js';
import { CURRENT_YEAR, assetValue, sideValue, verdictFor } from './values.js';
import { openChat, postTrade } from './chat.js';

// ======================= TRADE BUILDER =======================
// Two columns of assets, tap to move one in or out. Draft picks sit in the same
// columns as players — they are assets, not an afterthought — and a pick in the
// deal can carry a condition. Players cannot: a conditional player is not a
// thing, and offering one would be a rules bug rather than a feature.

export let TB=null;   // {from,to,give,get,counterOf}

export const TRIGGERS=[
  ['playoffs','makes the playoffs'],
  ['championship','makes the championship'],
  ['points_threshold','scores over'],
];
export function triggerLabel(c){
  if(!c)return '';
  const t=(TRIGGERS.find(x=>x[0]===c.trigger)||[])[1]||c.trigger;
  const val=c.trigger==='points_threshold'?` ${c.value||0}`:'';
  return `${ordRound(c.upgradeTo)} if ${t}${val}`;
}
export function ordRound(r){
  r=+r||1;
  return r===1?'1st':r===2?'2nd':r===3?'3rd':r+'th';
}

// ---- assets ----
export function assetId(a){
  return a.kind==='pick'
    ? `pk:${a.pick.year}:${a.pick.round}:${a.pick.originalTeam}`
    : `pl:${(a.player&&(a.player.id||a.player.n))||''}`;
}
/** `holder` is whoever is offering the pick. A team's own pick reads plainly;
 *  only a pick that came from someone else earns the "via". */
export function pickLabel(pk,holder){
  const foreign=pk.originalTeam&&pk.originalTeam!==holder&&T[pk.originalTeam];
  const via=foreign?` (via ${T[pk.originalTeam].mgr})`:'';
  return `${pk.year} ${ordRound(pk.round)}${via}`;
}
/** The one chip used for an asset anywhere it appears — builder columns, trade
 *  cards in chat, and the counter that reopens the builder — so a condition
 *  written once follows the pick everywhere afterward. */
export function assetChipHTML(a,opts){
  opts=opts||{};
  const rm=opts.onRemove?` onclick="${opts.onRemove}"`:'';
  if(a.kind==='pick'){
    const c=a.pick.cond;
    return `<span class="as as-pick${opts.on?' on':''}"${rm}>
      <span class="as-ic">▦</span>
      <span class="as-nm">${escHtml(pickLabel(a.pick,opts.holder))}</span>
      ${c?`<span class="as-cond">${escHtml(triggerLabel(c))}</span>`:''}
    </span>`;
  }
  const p=a.player||{};
  return `<span class="as as-pl${opts.on?' on':''}"${rm}>
    <span class="as-face">${faceInner(p.id||p.n)}</span>
    <span class="as-nm">${escHtml(p.n||'')}</span>
    <span class="as-mt">${escHtml(p.pos||'')}</span>
  </span>`;
}

/** Each team's own picks for the next two years, plus one it holds from
 *  someone else, so `originalTeam` is a real field rather than always self. */
export function picksFor(key){
  const keys=Object.keys(T),i=Math.max(0,keys.indexOf(key));
  const out=[];
  [CURRENT_YEAR+1,CURRENT_YEAR+2].forEach(y=>{
    [1,2,3].forEach(r=>out.push({year:y,round:r,originalTeam:key}));
  });
  const from=keys[(i+3)%keys.length];
  if(from!==key)out.push({year:CURRENT_YEAR+1,round:2,originalTeam:from});
  return out.map(pk=>{
    const saved=(store.pickConds||{})[`${key}:${pk.year}:${pk.round}:${pk.originalTeam}`];
    return saved?Object.assign({},pk,{cond:saved}):pk;
  });
}

function inTrade(side,a){return side.some(x=>assetId(x)===assetId(a));}

// ---- the view ----
function column(key,side,which){
  const t=T[key];
  const roster=rosterFor(key)||[];
  const players=roster.map(p=>({kind:'player',player:{id:p.id,n:p.n,full:p.full,pos:p.pos,tm:p.tm}}));
  const picks=picksFor(key).map(pk=>({kind:'pick',pick:pk}));
  const rows=players.concat(picks).map(a=>{
    const on=inTrade(side,a);
    return `<div class="tb-row${on?' on':''}" onclick="toggleAsset('${which}','${assetId(a)}')">
      ${assetChipHTML(a,{on,holder:key})}
      <span class="tb-v">${assetValue(a)}</span>
      ${a.kind==='pick'&&on?`<span class="tb-cond" onclick="event.stopPropagation();openCond('${which}','${assetId(a)}')">⌁</span>`:''}
    </div>`;
  }).join('');
  return `<div class="tb-col">
    <div class="tb-ch" style="color:${t.c}">${escHtml(t.n)}</div>
    <div class="tb-list">${rows}</div>
  </div>`;
}

export function renderTrade(){
  if(!TB)return;
  const el=document.getElementById('tradeBody');if(!el)return;
  // "in" and "out" are always read from the user's seat.
  const mineIsFrom=TB.from===MY_TEAM;
  const outList=mineIsFrom?TB.give:TB.get;
  const inList=mineIsFrom?TB.get:TB.give;
  const outV=sideValue(outList),inV=sideValue(inList);
  const v=verdictFor(inV,outV);
  el.innerHTML=`
    <div class="tb-hd">
      <div class="tb-back" onclick="cancelTrade()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></div>
      <div class="tb-title">${escHtml((T[TB.from]||{}).n||'')} <span>↔</span> ${escHtml((T[TB.to]||{}).n||'')}</div>
      <div class="tb-send" onclick="submitTrade()">Send</div>
    </div>
    <div class="tb-cols">
      ${column(TB.from,TB.give,'give')}
      ${column(TB.to,TB.get,'get')}
    </div>
    <div class="tb-eval ${v.tone}">
      <div class="tb-bar"><i style="width:${v.pct}%"></i></div>
      <div class="tb-nums"><span>${outV}</span><b>${v.line}</b><span>${inV}</span></div>
    </div>`;
}

export function buildTrade(fromKey,toKey,prefill){
  prefill=prefill||{};
  TB={from:fromKey,to:toKey,
      give:(prefill.give||[]).map(clone),get:(prefill.get||[]).map(clone),
      counterOf:prefill.counterOf||null};
  renderTrade();
  showView('trade');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
function clone(a){return JSON.parse(JSON.stringify(a));}

export function toggleAsset(which,id){
  if(!TB)return;
  const key=which==='give'?TB.from:TB.to;
  const side=which==='give'?TB.give:TB.get;
  const i=side.findIndex(a=>assetId(a)===id);
  if(i>-1){side.splice(i,1);renderTrade();return;}
  const roster=rosterFor(key)||[];
  const all=roster.map(p=>({kind:'player',player:{id:p.id,n:p.n,full:p.full,pos:p.pos,tm:p.tm}}))
    .concat(picksFor(key).map(pk=>({kind:'pick',pick:pk})));
  const a=all.find(x=>assetId(x)===id);
  if(a)side.push(clone(a));
  renderTrade();
}
export function cancelTrade(){TB=null;openChat();}

export function submitTrade(){
  if(!TB)return;
  if(!TB.give.length&&!TB.get.length)return;
  const isCounter=!!TB.counterOf;
  if(isCounter){openNote();return;}
  finishTrade('');
}
export function finishTrade(note){
  const tr={from:TB.from,to:TB.to,status:TB.counterOf?'countered':'proposed',
            give:TB.give,get:TB.get,note:note||''};
  if(TB.counterOf){
    // the offer being answered is closed out, so the thread reads in order
    const prev=(store.chat&&store.chat[store.activeLeague||'cbd']||[]).find(m=>m.id===TB.counterOf);
    if(prev&&prev.trade)prev.trade.status='countered';
  }
  postTrade(tr,note);
  TB=null;saveStore();openChat();
}

// ---- condition sheet (picks only) ----
export let condTarget=null;
export function openCond(which,id){
  const side=which==='give'?TB.give:TB.get;
  const a=side.find(x=>assetId(x)===id);
  if(!a||a.kind!=='pick')return;
  condTarget={which,id};
  const c=a.pick.cond||{trigger:'playoffs',value:1500,upgradeTo:Math.max(1,(+a.pick.round||2)-1)};
  document.getElementById('condTitle').textContent=pickLabel(a.pick,which==='give'?TB.from:TB.to);
  document.getElementById('condBody').innerHTML=`
    <div class="cond-row">
      <select id="condTrig" class="set-ctl" onchange="syncCond()">
        ${TRIGGERS.map(t=>`<option value="${t[0]}"${c.trigger===t[0]?' selected':''}>${t[1]}</option>`).join('')}
      </select>
    </div>
    <div class="cond-row" id="condValRow" style="display:${c.trigger==='points_threshold'?'flex':'none'}">
      <input id="condVal" class="set-ctl" type="number" value="${c.value||1500}">
    </div>
    <div class="cond-row">
      <select id="condUp" class="set-ctl">
        ${[1,2,3,4].map(r=>`<option value="${r}"${+c.upgradeTo===r?' selected':''}>becomes a ${ordRound(r)}</option>`).join('')}
      </select>
    </div>
    <div class="cond-btns">
      <div class="tc-btn dec" onclick="clearCond()">Remove</div>
      <div class="tc-btn acc" onclick="saveCond()">Save</div>
    </div>`;
  document.getElementById('condScrim').classList.add('show');
  document.getElementById('condSheet').classList.add('show');
}
export function syncCond(){
  const t=document.getElementById('condTrig').value;
  document.getElementById('condValRow').style.display=t==='points_threshold'?'flex':'none';
}
export function closeCond(){
  document.getElementById('condScrim').classList.remove('show');
  document.getElementById('condSheet').classList.remove('show');
  condTarget=null;
}
export function saveCond(){
  if(!condTarget)return;
  const side=condTarget.which==='give'?TB.give:TB.get;
  const a=side.find(x=>assetId(x)===condTarget.id);
  if(!a){closeCond();return;}
  const trigger=document.getElementById('condTrig').value;
  const upgradeTo=+document.getElementById('condUp').value;
  const value=trigger==='points_threshold'?+document.getElementById('condVal').value:null;
  a.pick.cond={trigger,value,upgradeTo};
  rememberCond(condTarget.which,a);
  closeCond();renderTrade();
}
export function clearCond(){
  if(!condTarget)return;
  const side=condTarget.which==='give'?TB.give:TB.get;
  const a=side.find(x=>assetId(x)===condTarget.id);
  if(a){delete a.pick.cond;forgetCond(condTarget.which,a);}
  closeCond();renderTrade();
}
/** A condition belongs to the pick, not to this one card, so it survives the
 *  trade and shows on the asset everywhere it appears afterward. */
function condKey(which,a){
  const owner=which==='give'?TB.from:TB.to;
  return `${owner}:${a.pick.year}:${a.pick.round}:${a.pick.originalTeam}`;
}
function rememberCond(which,a){
  if(!store.pickConds)store.pickConds={};
  store.pickConds[condKey(which,a)]=a.pick.cond;saveStore();
}
function forgetCond(which,a){
  if(store.pickConds)delete store.pickConds[condKey(which,a)];
  saveStore();
}

// ---- counter note ----
export function openNote(){
  document.getElementById('noteTitle').textContent='Counter';
  document.getElementById('noteBody').innerHTML=`
    <div class="cond-row"><input id="noteVal" class="set-ctl" type="text" autocomplete="off"></div>
    <div class="cond-btns"><div class="tc-btn acc" onclick="sendNote()">Send</div></div>`;
  document.getElementById('noteScrim').classList.add('show');
  document.getElementById('noteSheet').classList.add('show');
}
export function closeNote(){
  document.getElementById('noteScrim').classList.remove('show');
  document.getElementById('noteSheet').classList.remove('show');
}
export function sendNote(){
  const v=(document.getElementById('noteVal')||{}).value||'';
  closeNote();
  finishTrade(v.trim());
}
