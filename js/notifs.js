import { S } from './state.js';
import { LG } from './data/league-config.js';
import { MY_TEAM, T } from './data/teams.js';
import { draftDone, myTurn, onClockIdx, onClockTeam, pickMeta } from './draft.js';
import { LEAGUES, activeLeagueId, leagueById, openLeague } from './leagues.js';
import { LIVE_WEEK } from './lineup.js';
import { showView, toggleDrawer } from './nav.js';
import { escHtml } from './panel.js';
import { saveStore, store } from './store.js';

// ======================= NOTIFICATIONS =======================
// The only surface for anything time-based. There are deliberately no waiver
// banners, no recap ribbons and no dashboard strips anywhere else in the app —
// if it is driven by the clock, it arrives here or it does not arrive.
//
//   store.notifs = [{id, ts, type, title, body, leagueId, read}]
//
// Generators read the device clock and nothing else. Each one writes through a
// dedupe key, which is what keeps "one notification" per waiver window honest
// across reloads.

export const NOTIF_TYPES=[
  ['waiver_open','Waivers open'],
  ['waiver_closing','Waivers closing'],
  ['recap','Weekly recap'],
  ['draft_clock','Draft clock'],
  ['trade','Trades'],
];
export const NOTIF_DEFAULTS={waiver_open:true,waiver_closing:true,recap:true,draft_clock:true,trade:true};

export function notifs(){if(!store.notifs)store.notifs=[];return store.notifs;}
export function notifPrefs(){
  store.notifPrefs=Object.assign({},NOTIF_DEFAULTS,store.notifPrefs||{});
  return store.notifPrefs;
}
export function setNotifPref(type,on){
  notifPrefs()[type]=!!on;saveStore();renderNotifs();paintBell();
}
export function unreadNotifs(){return notifs().filter(n=>!n.read).length;}

export function pushNotif(o){
  if(!notifPrefs()[o.type])return null;
  if(o.key){
    if(!store.notifKeys)store.notifKeys={};
    if(store.notifKeys[o.key])return null;
    store.notifKeys[o.key]=1;
  }
  store.notifSeq=(store.notifSeq||0)+1;
  const n=Object.assign({id:'n'+store.notifSeq,ts:Date.now(),read:false,leagueId:activeLeagueId()},o);
  notifs().unshift(n);
  if(notifs().length>60)notifs().length=60;
  saveStore();paintBell();
  return n;
}
export function markAllRead(){notifs().forEach(n=>{n.read=true;});saveStore();renderNotifs();paintBell();}
export function paintBell(){
  const n=unreadNotifs(),el=document.getElementById('lbBell');
  if(!el)return;
  let b=el.querySelector('.b');
  if(n&&!b){b=document.createElement('span');b.className='b';el.appendChild(b);}
  if(b){b.textContent=n;b.style.display=n?'grid':'none';}
}

// ---- waiver clock ----
/** Next processing time for a league, from its own commissioner settings. */
export function waiverClose(lgId){
  const L=LG(),day=+L.waiverDay,hour=+L.waiverHour;
  const d=new Date();
  d.setHours(hour,0,0,0);
  let delta=(day-d.getDay()+7)%7;
  if(delta===0&&d.getTime()<=Date.now())delta=7;
  d.setDate(d.getDate()+delta);
  return d.getTime();
}
/** Claims open the moment the previous batch processed, which is what makes
 *  "one notification" per cycle a whole week rather than a 24-hour sliver. */
export function waiverOpen(lgId){return waiverClose(lgId)-7*86400000;}
/** Device-local, and dated: a window that opens and closes on the same weekday
 *  reads as one instant twice over without the date. */
export function fmtLocal(ts){
  return new Date(ts).toLocaleString(undefined,
    {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
export function waiverState(lgId){
  const priority=(store.waivers&&store.waivers[lgId]&&store.waivers[lgId].priority)||1;
  const faab=(store.waivers&&store.waivers[lgId]&&store.waivers[lgId].faab)||0;
  return {priority,faab,budget:+LG().faabBudget||100};
}

// ---- generators ----
export function runGenerators(){
  const now=Date.now();
  LEAGUES.forEach(lg=>{
    if(lg.id!=='cbd')return;   // waivers/recaps only run in the live league
    const close=waiverClose(lg.id),open=waiverOpen(lg.id);
    if(now>=open&&now<close){
      const w=waiverState(lg.id);
      pushNotif({type:'waiver_open',key:`waiver_open:${lg.id}:${close}`,leagueId:lg.id,
        title:'Waivers open',
        body:`Priority ${w.priority} · ${w.faab} of ${w.budget} FAAB · ${fmtLocal(open)} → ${fmtLocal(close)}`});
    }
    if(close-now<=300000&&close-now>0){
      pushNotif({type:'waiver_closing',key:`waiver_closing:${lg.id}:${close}`,leagueId:lg.id,
        title:'Waivers close in 5 minutes',body:''});
    }
    // Tuesday, once the Monday night game is behind us
    const d=new Date();
    if(d.getDay()===2){
      const wk=Math.max(1,LIVE_WEEK);
      pushNotif({type:'recap',key:`recap:${lg.id}:${weekStamp(d)}`,leagueId:lg.id,
        title:`Week ${wk} recap ready`,body:''});
    }
  });
  notifyDraftClock();
}
function weekStamp(d){
  const t=new Date(d.getFullYear(),0,1);
  return d.getFullYear()+'-'+Math.floor((d-t)/604800000);
}
/** Fired as each pick lands, so "on the clock" and "up next" arrive once each. */
export function notifyDraftClock(){
  if(draftDone())return;
  const i=onClockIdx(),lid='cbd';
  if(onClockTeam()===MY_TEAM){
    const m=pickMeta(i);
    pushNotif({type:'draft_clock',key:`clock:${lid}:${i}`,leagueId:lid,
      title:'On the clock',body:`Round ${m.round}, pick ${m.pick}`});
  }
  const nextIdx=i+1;
  if(nextIdx<i+3){
    const nm=pickMeta(nextIdx);
    if(nm.team===MY_TEAM&&!myTurn()){
      pushNotif({type:'draft_clock',key:`next:${lid}:${nextIdx}`,leagueId:lid,
        title:'Up next',body:`Round ${nm.round}, pick ${nm.pick}`});
    }
  }
}

// ---- view ----
const ICONS={
  waiver_open:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  waiver_closing:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  recap:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h6"/>',
  draft_clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 3"/>',
  trade:'<path d="M7 8h13l-3-3M17 16H4l3 3"/>',
};
export function renderNotifs(){
  const el=document.getElementById('notifBody');if(!el)return;
  const list=notifs();
  el.innerHTML=`
    <div class="nt-hd">
      <div class="nt-back" onclick="backFromNotifs()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></div>
      <div class="nt-title">Notifications</div>
      ${list.some(n=>!n.read)?`<div class="nt-clear" onclick="markAllRead()">Mark read</div>`:'<div></div>'}
    </div>
    <div class="nt-list">${list.map(n=>{
      const lg=leagueById(n.leagueId);
      return `<div class="nt${n.read?'':' un'}" onclick="openNotif('${n.id}')">
        <span class="nt-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[n.type]||ICONS.recap}</svg></span>
        <div class="nt-b">
          <div class="nt-t">${escHtml(n.title||'')}</div>
          ${n.body?`<div class="nt-s">${escHtml(n.body)}</div>`:''}
          <div class="nt-m">${escHtml(lg.name)} · ${relTime(n.ts)}</div>
        </div>
      </div>`;
    }).join('')}</div>`;
}
function relTime(ts){
  const s=Math.max(0,Math.floor((Date.now()-ts)/1000));
  if(s<60)return 'now';
  if(s<3600)return Math.floor(s/60)+'m';
  if(s<86400)return Math.floor(s/3600)+'h';
  return Math.floor(s/86400)+'d';
}
export function openNotifs(){
  S.notifBackView=currentBack();
  renderNotifs();
  showView('notifs');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
function currentBack(){
  const v=document.querySelector('.view.on');
  const n=v?v.dataset.view:'matchup';
  return n==='notifs'?'matchup':n;
}
export function backFromNotifs(){
  const v=S.notifBackView||'matchup';
  S.notifBackView=null;
  if(v==='home'){showView('home');if(window.renderHome)window.renderHome();return;}
  if(v==='chat'&&window.openChat){window.openChat();return;}
  if(window.showTab)window.showTab(v==='matchup'?window.homeTab():v);
  else showView('matchup');
}
/** Deep-link: the league first, then the surface that notification is about. */
export function openNotif(id){
  const n=notifs().find(x=>x.id===id);if(!n)return;
  n.read=true;saveStore();paintBell();
  openLeague(n.leagueId);
  if(n.type==='trade'&&window.openChat){window.openChat();return;}
  if(n.type==='draft_clock'&&window.showTab){window.showTab('draft');return;}
  if((n.type==='waiver_open'||n.type==='waiver_closing')&&window.selectRail){
    if(!document.body.classList.contains('open'))toggleDrawer();
    window.selectRail('available');
    return;
  }
  if(window.showTab)window.showTab(window.homeTab());
}

export function initNotifs(){
  store.notifs=store.notifs||[];
  notifPrefs();
  if(!store.waivers){
    store.waivers={};
    LEAGUES.forEach(lg=>{
      const t=T[lg.myTeamKey];
      store.waivers[lg.id]={priority:(t&&t.rk)||1,faab:Math.max(0,(+LG().faabBudget||100)-22)};
    });
  }
  runGenerators();
  paintBell();
}
