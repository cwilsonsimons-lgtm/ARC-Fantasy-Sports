// Leagues: the selector, the Create League wizard, and the home screen for
// leagues that exist as settings only (no season behind them yet).
//
// City Boys Dynasty is the playable prototype league. A league created here is
// a real, fully editable settings object — league config, scoring, roster
// shape — owned by store.leagues. Opening one flips store.curLeagueId so the
// whole Settings engine (LG/SC/SLOTS) reads and writes the new league; the
// game tabs keep belonging to City Boys Dynasty.
import { LEAGUE_DEFAULTS, SCORING_DEFAULTS, allLeagues, curLeague, findLeague } from './data/league-config.js';
import { MY_TEAM } from './data/teams.js';
import { homeTab, showTab, showView, toast, toggleDrawer } from './nav.js';
import { SLOT_DEFAULTS, saveStore, store } from './store.js';
import { openSettings } from './settings.js';
import { escAttr, escHtml } from './panel.js';
import { S } from './state.js';

// ---------------------------------------------------------------- helpers
const HOME_NAME='City Boys Dynasty';
const TYPE_LABEL={redraft:'Redraft',keeper:'Keeper',dynasty:'Dynasty'};
const DRAFT_LABEL={snake:'Snake',linear:'Linear',auction:'Auction'};
const CREST_COLS=['#8CE04A','#5AA9E6','#C77DFF','#E6A85A','#5AE6B5','#E65A7A','#7D9BFF','#E6D15A'];
function crestCol(name){let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;return CREST_COLS[h%CREST_COLS.length];}
function crest(name,cls){
  const c=crestCol(name);
  return `<div class="${cls}" style="color:${c};background:${c}22;border-color:${c}55">${escHtml((name.trim()[0]||'?').toUpperCase())}</div>`;
}
function clearTabs(){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));}
function landOn(view){
  showView(view);clearTabs();
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function syncLeaguebar(){
  const n=document.getElementById('lbName'),w=document.getElementById('lbWeek'),c=curLeague();
  if(n)n.textContent=c?c.name:HOME_NAME;
  if(w)w.textContent=c?'PREDRAFT':'WEEK '+S.week;   // matches renderWeek()'s label
}

/** Back button on the Settings page: created leagues return to their home
 *  screen, the playable league returns to the game tabs as before. */
export function settingsBack(){
  if(curLeague())openLeagueHome();
  else showTab(homeTab());
}

// ---------------------------------------------------------------- selector
export function openLeagues(){
  renderLeagues();
  landOn('leagues');
}
export function renderLeagues(){
  const cur=curLeague();
  const home=store.league||LEAGUE_DEFAULTS;
  const homeRole=home.commish===MY_TEAM?'Commissioner':'Member';
  const cards=[`
    <div class="lg-card" onclick="switchLeague('')">
      ${crest(HOME_NAME,'lg-crest')}
      <div class="lg-info">
        <div class="lg-name">${HOME_NAME}</div>
        <div class="lg-meta">${TYPE_LABEL[home.type]||'Dynasty'} · ${home.teams} teams · ${homeRole}</div>
      </div>
      ${cur?'':'<div class="lg-cur">Current</div>'}
    </div>`]
    .concat(allLeagues().map(l=>`
    <div class="lg-card" onclick="openLeagueHome('${l.id}')">
      ${crest(l.name,'lg-crest')}
      <div class="lg-info">
        <div class="lg-name">${escHtml(l.name)}</div>
        <div class="lg-meta">${TYPE_LABEL[l.league.type]||''} · ${l.league.teams} teams · Commissioner</div>
        <div class="lg-sub">Awaiting draft</div>
      </div>
      ${cur&&cur.id===l.id?'<div class="lg-cur">Current</div>':''}
    </div>`));
  // resumable wizard progress shows on the create card (it auto-saves)
  const w=store.createLeague;
  const createSub=w&&(w.step>0||(w.name&&w.name.trim()))
    ? `Resume setup · Step ${Math.min(w.step+1,WIZ_TOTAL)} of ${WIZ_TOTAL}`
    : 'Start a new league — you will be the commissioner';
  document.getElementById('leaguesBody').innerHTML=`
    <div class="set-h">Your Leagues</div>
    <div class="set-sub">Tap a league to open it</div>
    ${cards.join('')}
    <div class="lg-card lg-new" onclick="openCreateLeague()">
      <div class="lg-crest lg-plus">+</div>
      <div class="lg-info">
        <div class="lg-name">Create League</div>
        <div class="lg-sub">${createSub}</div>
      </div>
    </div>`;
}
export function switchLeague(id){
  store.curLeagueId=id||null;saveStore();syncLeaguebar();
  if(!id){showTab(homeTab());return;}
  openLeagueHome();
}

// ---------------------------------------------------------------- wizard
// Progress lives in store.createLeague and is saved on every change, so a
// half-finished league survives leaving the wizard (and reloads).
export const WIZ_TOTAL=6;
const WIZ_BLANK={step:0,name:'',source:null,copyFrom:null,type:null,startup:'all',size:10,custom:'',draftType:null};
export function wiz(){return store.createLeague=store.createLeague||Object.assign({},WIZ_BLANK);}
function wsave(){saveStore();}
export const SIZE_PRESETS=[4,6,8,10,12,14,16];
export const SIZE_MIN=4,SIZE_MAX=32;
function wizTeams(){const w=wiz();return w.size==='custom'?Math.round(+w.custom):+w.size;}
function memberLeagues(){
  // every league this user belongs to, copyable as a starting point
  return [{id:'home',name:HOME_NAME,league:store.league,scoring:store.scoring,slots:store.slots}]
    .concat(allLeagues());
}
function stepValid(i){
  const w=wiz();
  switch(i){
    case 0:return !!w.name.trim();
    case 1:return w.source==='default'||(w.source==='copy'&&!!w.copyFrom);
    case 2:return !!w.type;
    case 3:{const t=wizTeams();return isFinite(t)&&t>=SIZE_MIN&&t<=SIZE_MAX;}
    case 4:return !!w.draftType;
    default:return true;
  }
}
function stepBlocker(i){
  switch(i){
    case 0:return 'Give the league a name first';
    case 1:return wiz().source==='copy'?'Pick which league to copy':'Choose how to start the settings';
    case 2:return 'Pick a league type';
    case 3:return `Team count must be ${SIZE_MIN}–${SIZE_MAX}`;
    case 4:return 'Pick a draft type';
    default:return '';
  }
}
export function wizPick(k,v){
  const w=wiz();
  w[k]=v;
  if(k==='source'&&v==='default')w.copyFrom=null;
  wsave();renderWizard();
}
export function wizPickCopy(id){
  const w=wiz();
  w.source='copy';w.copyFrom=id;
  // prefill the later steps from the copied league — still editable there
  const src=id==='home'?store.league:(findLeague(id)||{}).league;
  if(src){
    w.type=src.type;
    w.draftType=src.draftType||'snake';
    w.size=SIZE_PRESETS.indexOf(+src.teams)>-1?+src.teams:'custom';
    w.custom=String(src.teams);
    if(src.type==='dynasty')w.startup=src.draftPool==='rookies'?'rookies':'all';
  }
  wsave();renderWizard();
}
// name and custom-size fields save on every keystroke without re-rendering
// (a re-render would steal focus mid-word); only the Next button reacts live
export function wizName(v){wiz().name=v;wsave();wizSyncNext();}
export function wizCustom(v){wiz().custom=v;wsave();wizSyncNext();
  const o=document.getElementById('wizOdd');if(o)o.innerHTML=oddNote();}
function wizSyncNext(){
  const b=document.getElementById('wizNext');
  if(b)b.classList.toggle('off',!stepValid(wiz().step));
}
export function wizGo(i){const w=wiz();w.step=Math.max(0,Math.min(WIZ_TOTAL-1,i));wsave();renderWizard();}
export function wizNext(){
  const w=wiz();
  if(!stepValid(w.step)){toast(stepBlocker(w.step));return;}
  if(w.step>=WIZ_TOTAL-1)return;
  w.step++;wsave();renderWizard();
  document.getElementById('scroll').scrollTop=0;
}
export function wizBack(){
  const w=wiz();
  if(w.step===0){openLeagues();return;}   // progress stays saved
  w.step--;wsave();renderWizard();
  document.getElementById('scroll').scrollTop=0;
}
export function openCreateLeague(){
  renderWizard();
  landOn('createLeague');
}

function optCard(on,click,title,desc){
  return `<div class="opt-card${on?' on':''}" onclick="${click}">
    <div class="opt-t"><span class="opt-radio"></span>${title}</div>
    ${desc?`<div class="opt-d">${desc}</div>`:''}
  </div>`;
}
function stepName(){
  const w=wiz();
  const chips=['City Boys Dynasty II','Family Football League','Work Fantasy League']
    .map(n=>`<div class="wiz-chip" onclick="wizName('${n}');document.getElementById('wizNameIn').value='${n}'">${n}</div>`).join('');
  return `
    <div class="wiz-q">Name your league</div>
    <div class="wiz-s">This is what everyone sees at the top of the app. You can rename it later in League Settings.</div>
    <input id="wizNameIn" class="wiz-input" type="text" maxlength="40" placeholder="League name"
      value="${escAttr(w.name)}" oninput="wizName(this.value)">
    <div class="wiz-chips">${chips}</div>
    <div class="wiz-note">You will automatically be the commissioner of this league.</div>`;
}
function stepSource(){
  const w=wiz();
  const copyList=w.source==='copy'?`<div class="sub-opts">${memberLeagues().map(l=>`
    <div class="opt-card sm${w.copyFrom===l.id?' on':''}" onclick="wizPickCopy('${l.id}')">
      <div class="opt-t"><span class="opt-radio"></span>${escHtml(l.name)}</div>
      <div class="opt-d">${TYPE_LABEL[l.league.type]||''} · ${l.league.teams} teams · ${DRAFT_LABEL[l.league.draftType]||'Snake'} draft</div>
    </div>`).join('')}
    <div class="wiz-note">Copies every setting — rosters, scoring, draft, waivers, trades and the rest. All of it stays editable.</div>
  </div>`:'';
  return `
    <div class="wiz-q">Starting settings</div>
    <div class="wiz-s">How should this league be configured to begin with?</div>
    ${optCard(w.source==='copy',"wizPick('source','copy')",'Copy an existing league',
      'Start from the settings of a league you are already in.')}
    ${copyList}
    ${optCard(w.source==='default',"wizPick('source','default')",'Start from default',
      'Use the standard settings. Fine-tune everything later in League Settings.')}`;
}
function stepType(){
  const w=wiz();
  const startup=w.type==='dynasty'?`<div class="sub-opts">
    <div class="wiz-sub-h">Startup draft</div>
    <div class="opt-card sm${w.startup==='rookies'?' on':''}" onclick="wizPick('startup','rookies')">
      <div class="opt-t"><span class="opt-radio"></span>Rookie only startup draft</div>
      <div class="opt-d">Only this year's rookie class is in the startup draft.</div>
    </div>
    <div class="opt-card sm${w.startup!=='rookies'?' on':''}" onclick="wizPick('startup','all')">
      <div class="opt-t"><span class="opt-radio"></span>Veteran + rookie startup draft</div>
      <div class="opt-d">Every NFL player is in the startup draft.</div>
    </div>
  </div>`:'';
  return `
    <div class="wiz-q">What kind of league is this?</div>
    ${optCard(w.type==='redraft',"wizPick('type','redraft')",'Redraft',
      'Every season starts completely fresh — a full draft every year, no players carry over.')}
    ${optCard(w.type==='keeper',"wizPick('type','keeper')",'Keeper',
      'A new draft every season, but each team keeps a set number of players first. Everyone else returns to the pool. The keeper count is set in League Settings.')}
    ${optCard(w.type==='dynasty',"wizPick('type','dynasty')",'Dynasty',
      'Teams own their players year over year. Players stay rostered until they are traded, dropped or retired.')}
    ${startup}`;
}
function stepSize(){
  const w=wiz();
  const cells=SIZE_PRESETS.map(n=>
    `<div class="size-cell${w.size===n?' on':''}" onclick="wizPick('size',${n})">${n}<span class="s">TEAMS</span></div>`).join('')
    +`<div class="size-cell${w.size==='custom'?' on':''}" onclick="wizPick('size','custom')">✎<span class="s">CUSTOM</span></div>`;
  const custom=w.size==='custom'?`
    <input class="wiz-input num" type="number" inputmode="numeric" min="${SIZE_MIN}" max="${SIZE_MAX}"
      placeholder="Number of teams (${SIZE_MIN}–${SIZE_MAX})" value="${escAttr(w.custom)}" oninput="wizCustom(this.value)">`:'';
  return `
    <div class="wiz-q">How many teams?</div>
    <div class="wiz-s">Including yours. This can change later, up until the draft.</div>
    <div class="size-grid">${cells}</div>
    ${custom}<div id="wizOdd">${oddNote()}</div>`;
}
function oddNote(){
  const t=wizTeams();
  return isFinite(t)&&t>=SIZE_MIN&&t<=SIZE_MAX&&t%2===1
    ?'<div class="wiz-note">Odd team counts mean one team sits on a bye each week.</div>':'';
}
function stepDraft(){
  const w=wiz();
  return `
    <div class="wiz-q">How will you draft?</div>
    ${optCard(w.draftType==='snake',"wizPick('draftType','snake')",'Snake draft',
      'Draft order reverses every round.')}
    ${optCard(w.draftType==='linear',"wizPick('draftType','linear')",'Linear draft',
      'The same order is used every round.')}
    ${optCard(w.draftType==='auction',"wizPick('draftType','auction')",'Auction draft',
      'Managers bid on players using a league budget.')}`;
}
function stepReview(){
  const w=wiz();
  const srcLabel=w.source==='default'?'Default settings'
    :`Copied from ${escHtml((memberLeagues().find(l=>l.id===w.copyFrom)||{}).name||'?')}`;
  const typeLabel=(TYPE_LABEL[w.type]||'')+(w.type==='dynasty'
    ?` · ${w.startup==='rookies'?'Rookie only':'Veteran + rookie'} startup`:'');
  const rows=[
    ['League name',escHtml(w.name.trim()),0],
    ['Starting settings',srcLabel,1],
    ['League type',typeLabel,2],
    ['Teams',String(wizTeams()),3],
    ['Draft type',DRAFT_LABEL[w.draftType]||'',4],
  ].map(r=>`<div class="rev-row" onclick="wizGo(${r[2]})">
      <div class="rev-lb">${r[0]}</div><div class="rev-val">${r[1]}</div><div class="rev-edit">›</div>
    </div>`).join('');
  return `
    <div class="wiz-q">Review &amp; create</div>
    <div class="wiz-s">Tap any line to change it.</div>
    <div class="set-card rev-card">${rows}</div>
    <div class="set-card wiz-comm">
      <div class="opt-t">★ You'll be the commissioner</div>
      <div class="opt-d">As the league creator you take the commissioner role automatically. Scoring, rosters,
        waivers, playoffs and every other setting are yours to configure in League Settings.</div>
    </div>`;
}
export function renderWizard(){
  const w=wiz();
  const bodies=[stepName,stepSource,stepType,stepSize,stepDraft,stepReview];
  const segs=Array.from({length:WIZ_TOTAL},(_,i)=>`<div class="wiz-seg${i<=w.step?' on':''}"></div>`).join('');
  const last=w.step===WIZ_TOTAL-1;
  const next=last
    ? `<div class="wiz-btn primary" onclick="wizCreate()">Create League</div>`
    : `<div id="wizNext" class="wiz-btn primary${stepValid(w.step)?'':' off'}" onclick="wizNext()">Next</div>`;
  document.getElementById('createLeagueBody').innerHTML=`
    <div class="wiz-top">
      <div class="wiz-x" onclick="openLeagues()" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </div>
      <div>
        <div class="set-h" style="margin:0">Create League</div>
        <div class="wiz-step">STEP ${w.step+1} OF ${WIZ_TOTAL}</div>
      </div>
    </div>
    <div class="wiz-prog">${segs}</div>
    ${bodies[w.step]()}
    <div class="wiz-foot">
      <div class="wiz-btn" onclick="wizBack()">${w.step===0?'Cancel':'Back'}</div>
      ${next}
    </div>
    <div class="wiz-save">Progress saves automatically</div>`;
}
export function wizCreate(){
  const w=wiz();
  for(let i=0;i<WIZ_TOTAL-1;i++){
    if(!stepValid(i)){w.step=i;wsave();renderWizard();toast(stepBlocker(i));return;}
  }
  const cp=o=>JSON.parse(JSON.stringify(o||{}));
  const src=w.source==='copy'
    ? (w.copyFrom==='home'
        ? {league:store.league,scoring:store.scoring,slots:store.slots}
        : findLeague(w.copyFrom))
    : null;
  const league=Object.assign({},LEAGUE_DEFAULTS,src?cp(src.league):{});
  const scoring=Object.assign({},SCORING_DEFAULTS,src?cp(src.scoring):{});
  const slots=Object.assign({},SLOT_DEFAULTS,src?cp(src.slots):{});
  // the wizard's own choices override whatever was copied
  league.type=w.type;
  league.teams=wizTeams();
  league.draftType=w.draftType;
  if(w.type==='dynasty')league.draftPool=w.startup==='rookies'?'rookies':'all';
  league.commish=MY_TEAM;      // the creator is the commissioner, always
  league.draftOrder=null;      // no members yet, so no order to carry over
  const id='lg'+Date.now().toString(36)+Math.floor(Math.random()*46656).toString(36);
  allLeagues().push({id,name:w.name.trim(),created:Date.now(),league,scoring,slots});
  delete store.createLeague;
  store.curLeagueId=id;
  saveStore();syncLeaguebar();
  openLeagueHome();
  toast('League created — you are the commissioner');
}

// ---------------------------------------------------------------- league home
export function openLeagueHome(id){
  if(id){store.curLeagueId=id;saveStore();}
  const l=curLeague();
  if(!l){openLeagues();return;}
  syncLeaguebar();
  renderLeagueHome(l);
  landOn('leagueHome');
}
function renderLeagueHome(l){
  const L=l.league;
  const chips=[TYPE_LABEL[L.type],`${L.teams} teams`,`${DRAFT_LABEL[L.draftType]||'Snake'} draft`];
  if(L.type==='dynasty')chips.push(L.draftPool==='rookies'?'Rookie startup':'Vet + rookie startup');
  const when=L.draftDate?new Date(L.draftDate+'T'+(L.draftTime||'19:00')):null;
  const whenTxt=when&&!isNaN(when)
    ? when.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})
      +' · '+when.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
    : 'Not scheduled yet';
  document.getElementById('leagueHomeBody').innerHTML=`
    <div class="lh-hero">
      ${crest(l.name,'lh-crest')}
      <div class="lh-name">${escHtml(l.name)}</div>
      <div class="lh-comm">★ You are the commissioner</div>
      <div class="lh-badges">${chips.map(c=>`<div class="lh-chip">${c}</div>`).join('')}</div>
    </div>
    <div class="set-card">
      <div class="set-title">Draft</div>
      ${['Scheduled for','Format','Rounds'].map((lb,i)=>`<div class="set-row">
        <div class="set-lb">${lb}</div>
        <div class="lh-val">${[whenTxt,(DRAFT_LABEL[L.draftType]||'Snake')+' · '+secShort(L.draftPickSec)+' per pick',L.draftRounds][i]}</div>
      </div>`).join('')}
      <div class="set-note" style="margin-top:9px">The draft room opens once every team has joined.</div>
    </div>
    <div class="set-card">
      <div class="set-title">Teams <span class="c">1 OF ${L.teams} JOINED</span></div>
      <div class="set-note">You're in as commissioner. Manager invites aren't wired up in this prototype yet —
        the other ${L.teams-1} spots stay open for now.</div>
    </div>
    <div class="set-btns">
      <div class="set-btn primary" onclick="openSettings()">League Settings</div>
      <div class="set-btn" onclick="openLeagues()">Switch league</div>
    </div>`;
}
function secShort(s){s=+s||90;return s<60?s+'s':s<3600?(s/60)+' min':(s/3600)+' hr';}
