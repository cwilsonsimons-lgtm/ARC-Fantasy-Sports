import { S } from './state.js';
import { MY_TEAM, T } from './data/teams.js';
import { activeLeagueId, inRealLeague, openLeague } from './leagues.js';
import { showView, toggleDrawer } from './nav.js';
import { escHtml } from './panel.js';
import { markInner, saveStore, store } from './store.js';
import { assetChipHTML, buildTrade } from './trade.js';
import { pushNotif } from './notifs.js';

// ======================= CHAT =======================
// Trades live in the conversation that produced them. There is no DM inbox and
// no trade tab: the league chat is the league, and a one-to-one thread is the
// same surface filtered to two people.
//
//   store.chat[leagueId] = [{id, from, to, ts, kind, body, trade?, poll?}]
//
// `to` is what separates the two levels — a message with `to` belongs to that
// thread, a message without it is league-wide.

export const TRADE_STATUS=['proposed','countered','accepted','declined','expired'];

export function chatLog(id){
  const lid=id||activeLeagueId();
  if(!store.chat)store.chat={};
  if(!store.chat[lid])store.chat[lid]=[];
  return store.chat[lid];
}
export function msgId(){
  store.chatSeq=(store.chatSeq||0)+1;
  return 'm'+store.chatSeq;
}
export function pushMsg(m){
  const log=chatLog();
  log.push(Object.assign({id:msgId(),from:MY_TEAM,ts:Date.now(),kind:'text'},m));
  saveStore();
  return log[log.length-1];
}
export function findMsg(id){return chatLog().find(m=>m.id===id)||null;}
export function tradeMsgs(){return chatLog().filter(m=>m.kind==='trade');}
/** Unread badge on the chat icon: messages from other managers since last open. */
export function chatUnread(){
  if(!inRealLeague())return 0;
  const seen=(store.chatSeen||{})[activeLeagueId()]||0;
  return chatLog().filter(m=>m.from!==MY_TEAM&&m.ts>seen).length;
}
export function markChatSeen(){
  if(!store.chatSeen)store.chatSeen={};
  store.chatSeen[activeLeagueId()]=Date.now();
  saveStore();
  paintChatBadges();
}
export function paintChatBadges(){
  const n=chatUnread(),el=document.getElementById('lbChat');
  if(el){
    let b=el.querySelector('.b');
    if(n&&!b){b=document.createElement('span');b.className='b';el.appendChild(b);}
    if(b){b.textContent=n;b.style.display=n?'grid':'none';}
  }
  const sub=document.getElementById('mActivitySub');
  if(sub){
    const t=tradeMsgs().filter(m=>m.trade&&m.trade.status==='proposed'&&m.trade.to===MY_TEAM).length;
    sub.textContent=`${chatLog().length} messages · ${t} open offer${t===1?'':'s'}`;
  }
}

export function timeLabel(ts){
  const d=new Date(ts),now=new Date();
  const sameDay=d.toDateString()===now.toDateString();
  const hh=d.getHours(),mm=String(d.getMinutes()).padStart(2,'0');
  const t=`${hh%12||12}:${mm} ${hh<12?'AM':'PM'}`;
  return sameDay?t:`${d.getMonth()+1}/${d.getDate()} ${t}`;
}

// ---- trade cards ----
function statusPill(st){
  const cls={proposed:'prop',countered:'cnt',accepted:'acc',declined:'dec',expired:'exp'}[st]||'prop';
  return `<span class="tc-st ${cls}">${st}</span>`;
}
function sideBlock(key,list,label){
  const t=T[key]||{n:key,c:'var(--ink-2)',bg:'#1a1f28',mono:'?'};
  return `<div class="tc-side">
    <div class="tc-team"><span class="tc-bd" style="background:${t.bg};color:${t.c}">${markInner(t)}</span>
      <span class="tc-tn" style="color:${t.c}">${escHtml(t.n)}</span><span class="tc-dir">${label}</span></div>
    <div class="tc-assets">${list.length?list.map(a=>assetChipHTML(a,{holder:key})).join(''):'<span class="tc-none">—</span>'}</div>
  </div>`;
}
/** One trade card. Shared by league chat and by a one-to-one thread, so a card
 *  never renders two ways. */
export function tradeCardHTML(m){
  const tr=m.trade,mine=tr.to===MY_TEAM;
  const actionable=mine&&(tr.status==='proposed'||tr.status==='countered');
  const acts=actionable?`<div class="tc-acts">
      <div class="tc-btn acc" onclick="event.stopPropagation();acceptTrade('${m.id}')">Accept</div>
      <div class="tc-btn" onclick="event.stopPropagation();counterTrade('${m.id}')">Counter</div>
      <div class="tc-btn dec" onclick="event.stopPropagation();declineTrade('${m.id}')">Decline</div>
    </div>`:'';
  const note=tr.note?`<div class="tc-note">${escHtml(tr.note)}</div>`:'';
  return `<div class="tc">
    <div class="tc-hd">${statusPill(tr.status)}<span class="tc-ts">${timeLabel(m.ts)}</span></div>
    ${sideBlock(tr.from,tr.give,'sends')}
    <div class="tc-swap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg></div>
    ${sideBlock(tr.to,tr.get,'sends')}
    ${note}
    ${acts}
  </div>`;
}

// ---- polls ----
export function pollHTML(m){
  const p=m.poll,votes=p.votes||{};
  const tally={},total=Object.keys(votes).length;
  p.options.forEach(o=>tally[o]=0);
  Object.keys(votes).forEach(k=>{if(tally[votes[k]]!=null)tally[votes[k]]++;});
  const mine=votes[MY_TEAM]||null;
  return `<div class="pl">
    <div class="pl-q">${escHtml(p.question)}</div>
    ${p.options.map(o=>{
      const n=tally[o],pct=total?Math.round(n/total*100):0;
      return `<div class="pl-opt${mine===o?' on':''}" onclick="votePoll('${m.id}','${escHtml(o).replace(/'/g,"\\'")}')">
        <i style="width:${pct}%"></i>
        <span class="pl-lb">${escHtml(o)}</span><span class="pl-n">${pct}%</span>
      </div>`;
    }).join('')}
  </div>`;
}
export function votePoll(id,opt){
  const m=findMsg(id);if(!m||!m.poll)return;
  m.poll.votes=m.poll.votes||{};
  m.poll.votes[MY_TEAM]=opt;
  saveStore();renderChat();
}

// ---- message rows ----
function msgRow(m){
  const t=T[m.from]||{n:m.from,c:'var(--ink-2)',bg:'#1a1f28',mono:'?'};
  const own=m.from===MY_TEAM;
  if(m.kind==='system'){
    return `<div class="cm-sys">${escHtml(m.body||'')}${m.poll?pollHTML(m):''}</div>`;
  }
  const inner=m.kind==='trade'?tradeCardHTML(m)
    :m.kind==='poll'?pollHTML(m)
    :`<div class="cm-bub">${escHtml(m.body||'')}</div>`;
  return `<div class="cm${own?' own':''}">
    ${own?'':`<span class="cm-bd" style="background:${t.bg};color:${t.c}" onclick="openThread('${m.from}')">${markInner(t)}</span>`}
    <div class="cm-body">
      ${own?'':`<div class="cm-who" style="color:${t.c}">${escHtml(t.n)}</div>`}
      ${inner}
      <div class="cm-ts">${timeLabel(m.ts)}</div>
    </div>
  </div>`;
}

// ---- the view ----
export function renderChat(){
  const el=document.getElementById('chatBody');if(!el)return;
  const thread=S.chatThread;
  const log=chatLog().filter(m=>thread?(m.to===thread&&(m.from===MY_TEAM||m.from===thread))||(m.from===thread&&m.to===MY_TEAM):!m.to);
  const t=thread?T[thread]:null;
  const head=thread
    ? `<div class="ch-hd">
        <div class="ch-back" onclick="openChat()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></div>
        <span class="ch-bd" style="background:${t.bg};color:${t.c}">${markInner(t)}</span>
        <div class="ch-id"><div class="ch-nm" style="color:${t.c}">${escHtml(t.n)}</div><div class="ch-sub">${escHtml(t.mgr)}</div></div>
        <div class="ch-act" onclick="buildTrade('${MY_TEAM}','${thread}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg>
        </div>
      </div>`
    : `<div class="ch-hd">
        <div class="ch-back" onclick="backFromChat()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></div>
        <div class="ch-id"><div class="ch-nm">League Chat</div><div class="ch-sub">${chatLog().filter(m=>!m.to).length} messages</div></div>
      </div>`;
  el.innerHTML=`${head}
    <div class="ch-log" id="chLog">${log.map(msgRow).join('')}</div>
    <div class="ch-compose">
      <input id="chInput" type="text" autocomplete="off" onkeydown="if(event.key==='Enter')sendChat()">
      <div class="ch-send" onclick="sendChat()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m3 20 18-8L3 4l4 8-4 8Z"/></svg></div>
    </div>`;
  const lg=document.getElementById('chLog');if(lg)lg.scrollTop=lg.scrollHeight;
  markChatSeen();
}
export function sendChat(){
  const i=document.getElementById('chInput');if(!i)return;
  const v=(i.value||'').trim();if(!v)return;
  pushMsg(S.chatThread?{body:v,to:S.chatThread}:{body:v});
  i.value='';
  renderChat();
}
export function openChat(){
  if(!inRealLeague()){openLeague('cbd');}
  S.chatThread=null;
  S.chatBackView=currentBack();
  renderChat();
  showView('chat');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function openThread(key){
  if(!T[key]||key===MY_TEAM)return;
  S.chatThread=key;
  if(!S.chatBackView)S.chatBackView=currentBack();
  renderChat();
  showView('chat');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
function currentBack(){
  const v=document.querySelector('.view.on');
  const n=v?v.dataset.view:'matchup';
  return (n==='chat'||n==='trade')?'matchup':n;
}
export function backFromChat(){
  const v=S.chatBackView||'matchup';
  S.chatBackView=null;
  if(v==='home'){showView('home');if(window.renderHome)window.renderHome();return;}
  if(window.showTab)window.showTab(v==='matchup'?window.homeTab():v);
  else showView('matchup');
}

// ---- trade actions ----
export function postTrade(tr,note){
  const m=pushMsg({kind:'trade',from:tr.from,body:'',trade:Object.assign({},tr,{note:note||tr.note||''})});
  pushNotif({type:'trade',title:tr.status==='countered'?'Counter received':'Trade offer',
    body:`${(T[tr.from]||{}).n||tr.from} → ${(T[tr.to]||{}).n||tr.to}`,
    leagueId:activeLeagueId(),msgId:m.id});
  return m;
}
export function acceptTrade(id){
  const m=findMsg(id);if(!m||!m.trade)return;
  m.trade.status='accepted';
  const a=(T[m.trade.from]||{}).n||m.trade.from,b=(T[m.trade.to]||{}).n||m.trade.to;
  const sys=pushMsg({kind:'system',from:'league',to:null,
    body:`${a} and ${b} completed a trade.`,
    poll:{question:'Who won this trade?',options:[a,b,'Even'],votes:seedVotes(m.trade)}});
  pushNotif({type:'trade',title:'Trade accepted',body:`${a} ↔ ${b}`,
    leagueId:activeLeagueId(),msgId:sys.id});
  saveStore();renderChat();
}
export function declineTrade(id){
  const m=findMsg(id);if(!m||!m.trade)return;
  m.trade.status='declined';saveStore();renderChat();
}
export function counterTrade(id){
  const m=findMsg(id);if(!m||!m.trade)return;
  const tr=m.trade;
  // The counter is built from the recipient's seat: what they send is what they
  // were being asked for.
  buildTrade(MY_TEAM,tr.from,{give:tr.get,get:tr.give,counterOf:m.id});
}
/** The rest of the league votes; the user's own vote is theirs to cast. */
function seedVotes(tr){
  const out={},keys=Object.keys(T).filter(k=>k!==MY_TEAM);
  keys.forEach((k,i)=>{
    const a=(T[tr.from]||{}).n,b=(T[tr.to]||{}).n;
    let h=2166136261;const s=k+tr.from+tr.to;
    for(let j=0;j<s.length;j++){h^=s.charCodeAt(j);h=Math.imul(h,16777619);}
    out[k]=[a,b,'Even'][(h>>>0)%3];
  });
  return out;
}

// ---- seed ----
// The league arrives with a conversation already in it, so every trade-card
// state is reachable without having to manufacture one first.
export function initChat(){
  if(!store.chat)store.chat={};
  if(store.chatSeeded)return;
  store.chatSeeded=1;
  const lid='cbd',now=Date.now(),hr=3600000;
  store.chatSeq=store.chatSeq||0;
  const mk=o=>{store.chatSeq++;return Object.assign({id:'m'+store.chatSeq,ts:now-hr*6,kind:'text'},o);};
  store.chat[lid]=[
    mk({from:'barzal',ts:now-hr*26,body:'waiver order posted, check the sheet'}),
    mk({from:'doghouse',ts:now-hr*22,body:'someone take Pitts off my hands'}),
    mk({from:'saquon',ts:now-hr*20,kind:'trade',body:'',trade:{
      from:'saquon',to:MY_TEAM,status:'proposed',note:'',
      give:[{kind:'player',player:{n:'D. Henry',full:'Derrick Henry',pos:'RB',tm:'BAL'}}],
      get:[{kind:'player',player:{n:'B. Bowers',full:'Brock Bowers',pos:'TE',tm:'LV'}}]}}),
    mk({from:'radiator',ts:now-hr*8,kind:'trade',body:'',trade:{
      from:'radiator',to:MY_TEAM,status:'countered',
      note:'add a second and a fourth and it works for me',
      give:[{kind:'player',player:{n:'J. Jefferson',full:'Justin Jefferson',pos:'WR',tm:'MIN'}}],
      get:[{kind:'player',player:{n:'B. Robinson',full:'Bijan Robinson',pos:'RB',tm:'ATL'}},
           {kind:'pick',pick:{year:2027,round:2,originalTeam:'burrow',
             cond:{trigger:'championship',value:null,upgradeTo:1}}}]}}),
    mk({from:'burrow',ts:now-hr*3,body:'that Jefferson deal is robbery lol'}),
  ];
  store.chatSeen={};
  saveStore();
}
