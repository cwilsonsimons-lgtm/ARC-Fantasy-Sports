import { S } from './state.js';
import { MY_TEAM } from './data/teams.js';
import { renderDraft } from './draft-ui.js';
import { draftDone } from './draft.js';
import { currentViewName, renderTeam } from './team.js';

// ---------- NAV / TABS / DRAWER ----------
export function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on',v.dataset.view===name));
  document.querySelector('.shift').classList.toggle('stage-on', name==='matchup');
}
// Before the draft, the first tab is Draft instead of Matchup. Standings reads "League".
export function preDraft(){return !draftDone();}
export function TABS(){return preDraft()
  ? [{k:'draft',lb:'Draft'},{k:'team',lb:'Team'},{k:'standings',lb:'League'}]
  : [{k:'matchup',lb:'Matchup'},{k:'team',lb:'Team'},{k:'standings',lb:'League'}];}
export function homeTab(){return preDraft()?'draft':'matchup';}
export function renderTabs(active){
  const el=document.getElementById('tabs');if(!el)return;
  const cur=active||currentViewName();
  el.innerHTML=TABS().map(t=>`<div class="tab${t.k===cur?' on':''}" data-tab="${t.k}" onclick="showTab('${t.k}')">${t.lb}</div>`).join('');
}
export function showTab(name){
  if(name==='team'){renderTeam(MY_TEAM);S.teamBackView=homeTab();}
  if(name==='draft')renderDraft();
  renderTabs(name);
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===name));
  showView(name);
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function toggleDrawer(){document.body.classList.toggle('open');}

export function showLeagueView(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  showView('league');
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}

// VS gesture: double-tap OR long-press -> all matchups (re-bound each render)
export function goLeague(){showLeagueView();toast('All league matchups — tap any to open');}
export function bindVs(el){
  if(!el)return;
  el.addEventListener('dblclick',goLeague);
  let t;const s=()=>{clearTimeout(t);t=setTimeout(goLeague,500);};const e=()=>clearTimeout(t);
  el.addEventListener('mousedown',s);el.addEventListener('mouseup',e);el.addEventListener('mouseleave',e);
  el.addEventListener('touchstart',s,{passive:true});
  el.addEventListener('touchmove',e,{passive:true});   // any drag = scrolling, so cancel the long-press
  el.addEventListener('touchend',e);el.addEventListener('touchcancel',e);
}

export let ht;
export function toast(m){const h=document.getElementById('hint');h.textContent=m;h.classList.add('show');
  clearTimeout(ht);ht=setTimeout(()=>h.classList.remove('show'),1600);}
