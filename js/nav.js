import { S } from './state.js';
import { MY_TEAM } from './data/teams.js';
import { renderDraft } from './draft-ui.js';
import { draftDone } from './draft.js';
import { currentViewName, renderTeam } from './team.js';
import { activeLeague } from './leagues.js';
import { LG } from './data/league-config.js';

// ---------- NAV / TABS / DRAWER ----------
export function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on',v.dataset.view===name));
  // Stage mode hides the league bar and tabs in favour of the full-bleed
  // stadium. Kart scoring draws no stadium — there is no opponent — so the real
  // league keeps its normal chrome there, or the tab strip would vanish with
  // nothing replacing it. Seeded leagues still draw a stage, so they keep it.
  const lg=activeLeague();
  const stage=name==='matchup'&&!(lg&&lg.real&&kartMode());
  document.querySelector('.shift').classList.toggle('stage-on', stage);
  // The hub sits above league scope: `.leaguebar` and `.tabs` are league chrome
  // and must not render there.
  document.body.classList.toggle('hub', name==='home');
  // A league still forming keeps the league bar but has no league tabs to show.
  if(name!=='wait')document.body.classList.remove('forming');
}
// Before the draft, the first tab is Draft instead of Matchup. Standings reads "League".
export function preDraft(){return !draftDone();}
/**
 * A seeded league gets the same three tabs, routed through `s_` keys so one
 * `showTab` handles both kinds. They used to be inert labels on the stage,
 * which is why Team and League were unreachable outside City Boys Dynasty.
 *
 * Mario Kart scoring has no opponent, so the first tab reads Week and shows the
 * weekly leaderboard instead of a head-to-head.
 */
export function TABS(){
  const lg=activeLeague();
  if(lg&&!lg.real&&!lg.created)
    return [{k:'s_matchup',lb:'Matchup'},{k:'s_team',lb:'Team'},{k:'s_league',lb:'League'}];
  const first=preDraft()?{k:'draft',lb:'Draft'}
    :{k:'matchup',lb:kartMode()?'Week':'Matchup'};
  return [first,{k:'team',lb:'Team'},{k:'standings',lb:'League'}];
}
export function kartMode(){return (LG().standings||'record')==='kart';}
export function homeTab(){return preDraft()?'draft':'matchup';}
export function renderTabs(active){
  const el=document.getElementById('tabs');if(!el)return;
  const cur=active||currentViewName();
  el.innerHTML=TABS().map(t=>`<div class="tab${t.k===cur?' on':''}" data-tab="${t.k}" onclick="showTab('${t.k}')">${t.lb}</div>`).join('');
}
export function showTab(name){
  // seeded leagues route through the same call; the `s_` prefix picks the league
  if(name.indexOf('s_')===0){if(window.seededTab)window.seededTab(name.slice(2));return;}
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
export function goLeague(){showLeagueView();}
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
