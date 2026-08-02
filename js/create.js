import { LEAGUE_DEFAULTS, SCORING_DEFAULTS } from './data/league-config.js';
import { MY_TEAM } from './data/teams.js';
import { showView, toast, toggleDrawer } from './nav.js';
import { escHtml } from './panel.js';
import { SLOT_DEFAULTS, saveStore, store } from './store.js';
import { goHome, myLeagues } from './leagues.js';

// ======================= CREATE LEAGUE =======================
// Ported from the create-league wizard in the standalone prototype: same six
// steps, same option-card shape, same resume-where-you-left-off behaviour. What
// changed is where it writes — this repo keeps leagues in `store.myLeagues` and
// renders them on the hub, so there is no separate league-home to land on.
//
// Progress lives in `store.createLeague`, so closing the wizard mid-way and
// coming back later resumes rather than restarts.

export const WIZ_TOTAL = 6;
const WIZ_BLANK = {step:0,name:'',source:null,copyFrom:null,type:null,startup:'all',
                   size:10,custom:'',draftType:null,draftWhen:'now'};
export const SIZE_PRESETS=[4,6,8,10,12,14,16];
export const SIZE_MIN=4, SIZE_MAX=32;
export const TYPE_LABEL={redraft:'Redraft',keeper:'Keeper',dynasty:'Dynasty'};
export const DRAFT_LABEL={snake:'Snake',linear:'Linear',auction:'Auction'};
export const WHEN_LABEL={now:'Start now',hourly:'Rolling hourly'};

export function wiz(){return store.createLeague=store.createLeague||Object.assign({},WIZ_BLANK);}
function wsave(){saveStore();}
export function wizTeams(){const w=wiz();return w.size==='custom'?Math.round(+w.custom):+w.size;}

/** Leagues whose settings can be copied: the live one, plus anything created here. */
function memberLeagues(){
  return [{id:'cbd',name:'City Boys Dynasty',league:store.league,scoring:store.scoring,slots:store.slots}]
    .concat(myLeagues());
}
function findMine(id){return myLeagues().find(l=>l.id===id)||null;}

export function stepValid(i){
  const w=wiz();
  switch(i){
    case 0: return !!w.name.trim();
    case 1: return w.source==='default'||(w.source==='copy'&&!!w.copyFrom);
    case 2: return !!w.type;
    case 3: {const t=wizTeams();return isFinite(t)&&t>=SIZE_MIN&&t<=SIZE_MAX;}
    case 4: return !!w.draftType;
    default: return true;
  }
}
function stepBlocker(i){
  switch(i){
    case 0: return 'Give the league a name first';
    case 1: return wiz().source==='copy'?'Pick which league to copy':'Choose how to start the settings';
    case 2: return 'Pick a league type';
    case 3: return `Team count must be ${SIZE_MIN}–${SIZE_MAX}`;
    case 4: return 'Pick a draft type';
    default: return '';
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
  const src=id==='cbd'?store.league:(findMine(id)||{}).league;
  if(src){
    w.type=src.type;
    w.draftType=src.draftType||'snake';
    w.size=SIZE_PRESETS.indexOf(+src.teams)>-1?+src.teams:'custom';
    w.custom=String(src.teams);
    if(src.type==='dynasty')w.startup=src.draftPool==='rookies'?'rookies':'all';
  }
  wsave();renderWizard();
}
export function wizName(v){wiz().name=v;wsave();wizSyncNext();}
export function wizCustom(v){
  wiz().custom=v;wsave();wizSyncNext();
  const o=document.getElementById('wizOdd');if(o)o.innerHTML=oddNote();
}
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
  if(w.step===0){goHome();return;}
  w.step--;wsave();renderWizard();
  document.getElementById('scroll').scrollTop=0;
}
export function openCreateLeague(){
  renderWizard();
  showView('create');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}

function optCard(on,click,title,desc){
  return `<div class="opt-card${on?' on':''}" onclick="${click}">
    <div class="opt-t"><span class="opt-radio"></span>${title}</div>
    ${desc?`<div class="opt-d">${desc}</div>`:''}
  </div>`;
}

// ---- steps ----
function stepName(){
  const w=wiz();
  const chips=['City Boys Dynasty II','Family Football League','Work Fantasy League']
    .map(n=>`<div class="wiz-chip" onclick="wizName('${n}');document.getElementById('wizNameIn').value='${n}'">${n}</div>`).join('');
  return `<div class="wiz-q">Name your league</div>
    <input id="wizNameIn" class="wiz-input" type="text" maxlength="40"
      value="${escHtml(w.name).replace(/"/g,'&quot;')}" oninput="wizName(this.value)">
    <div class="wiz-chips">${chips}</div>`;
}
function stepSource(){
  const w=wiz();
  const copyList=w.source==='copy'?`<div class="sub-opts">${memberLeagues().map(l=>`
    <div class="opt-card sm${w.copyFrom===l.id?' on':''}" onclick="wizPickCopy('${l.id}')">
      <div class="opt-t"><span class="opt-radio"></span>${escHtml(l.name)}</div>
      <div class="opt-d">${TYPE_LABEL[l.league.type]||''} · ${l.league.teams} teams · ${DRAFT_LABEL[l.league.draftType]||'Snake'} draft</div>
    </div>`).join('')}</div>`:'';
  return `<div class="wiz-q">Starting settings</div>
    ${optCard(w.source==='copy',"wizPick('source','copy')",'Copy an existing league',
      'Start from the settings of a league you are already in.')}
    ${copyList}
    ${optCard(w.source==='default',"wizPick('source','default')",'Start from default',
      'Use the standard settings.')}`;
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
  return `<div class="wiz-q">What kind of league is this?</div>
    ${optCard(w.type==='redraft',"wizPick('type','redraft')",'Redraft',
      'Every season starts completely fresh — a full draft every year, no players carry over.')}
    ${optCard(w.type==='keeper',"wizPick('type','keeper')",'Keeper',
      'A new draft every season, but each team keeps a set number of players first.')}
    ${optCard(w.type==='dynasty',"wizPick('type','dynasty')",'Dynasty',
      'Teams own their players year over year, until they are traded, dropped or retired.')}
    ${startup}`;
}
function stepSize(){
  const w=wiz();
  const cells=SIZE_PRESETS.map(n=>
    `<div class="size-cell${w.size===n?' on':''}" onclick="wizPick('size',${n})">${n}<span class="s">TEAMS</span></div>`).join('')
    +`<div class="size-cell${w.size==='custom'?' on':''}" onclick="wizPick('size','custom')">✎<span class="s">CUSTOM</span></div>`;
  const custom=w.size==='custom'?`
    <input class="wiz-input num" type="number" inputmode="numeric" min="${SIZE_MIN}" max="${SIZE_MAX}"
      value="${escHtml(w.custom).replace(/"/g,'&quot;')}" oninput="wizCustom(this.value)">`:'';
  return `<div class="wiz-q">How many teams?</div>
    <div class="size-grid">${cells}</div>
    ${custom}<div id="wizOdd">${oddNote()}</div>`;
}
function oddNote(){
  const t=wizTeams();
  return (isFinite(t)&&t>=SIZE_MIN&&t<=SIZE_MAX&&t%2===1)
    ? '<div class="wiz-note">One team sits on a bye each week.</div>':'';
}
/** Draft format, and when it runs. "Instant" is the point: no calendar. */
function stepDraft(){
  const w=wiz();
  return `<div class="wiz-q">How will you draft?</div>
    ${optCard(w.draftType==='snake',"wizPick('draftType','snake')",'Snake draft','Draft order reverses every round.')}
    ${optCard(w.draftType==='linear',"wizPick('draftType','linear')",'Linear draft','The same order is used every round.')}
    ${optCard(w.draftType==='auction',"wizPick('draftType','auction')",'Auction draft','Managers bid on players using a league budget.')}
    <div class="sub-opts">
      <div class="wiz-sub-h">When</div>
      <div class="opt-card sm${w.draftWhen==='now'?' on':''}" onclick="wizPick('draftWhen','now')">
        <div class="opt-t"><span class="opt-radio"></span>Start now</div>
        <div class="opt-d">The draft opens the moment the league fills.</div>
      </div>
      <div class="opt-card sm${w.draftWhen==='hourly'?' on':''}" onclick="wizPick('draftWhen','hourly')">
        <div class="opt-t"><span class="opt-radio"></span>Rolling hourly</div>
        <div class="opt-d">Begins at the top of the next hour, and again every hour until everyone is in.</div>
      </div>
    </div>`;
}
function stepReview(){
  const w=wiz();
  const srcLabel=w.source==='default'?'Default settings'
    :`Copied from ${escHtml((memberLeagues().find(l=>l.id===w.copyFrom)||{}).name||'?')}`;
  const typeLabel=(TYPE_LABEL[w.type]||'')
    +(w.type==='dynasty'?` · ${w.startup==='rookies'?'Rookie only':'Veteran + rookie'} startup`:'');
  const rows=[
    ['League name',escHtml(w.name.trim()),0],
    ['Starting settings',srcLabel,1],
    ['League type',typeLabel,2],
    ['Teams',String(wizTeams()),3],
    ['Draft',`${DRAFT_LABEL[w.draftType]||''} · ${WHEN_LABEL[w.draftWhen]||''}`,4],
  ].map(r=>`<div class="rev-row" onclick="wizGo(${r[2]})">
      <div class="rev-lb">${r[0]}</div><div class="rev-val">${r[1]}</div><div class="rev-edit">›</div>
    </div>`).join('');
  return `<div class="wiz-q">Review &amp; create</div>
    <div class="set-card rev-card">${rows}</div>
    <div class="set-card wiz-comm">
      <div class="opt-t">★ You'll be the commissioner</div>
      <div class="opt-d">Scoring, rosters, waivers, playoffs and every other setting are yours to configure
        in League Settings.</div>
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
  document.getElementById('createBody').innerHTML=`
    <div class="wiz-top">
      <div class="wiz-x" onclick="goHome()" aria-label="Close">
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
    </div>`;
}

/** A token the invite link is built from. Stable per league, once created. */
function inviteToken(){
  return Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4);
}
export function inviteLink(lg){return `https://arc.app/join/${lg.invite}`;}

export function wizCreate(){
  const w=wiz();
  for(let i=0;i<WIZ_TOTAL-1;i++){
    if(!stepValid(i)){w.step=i;wsave();renderWizard();toast(stepBlocker(i));return;}
  }
  const cp=o=>JSON.parse(JSON.stringify(o||{}));
  const src=w.source==='copy'
    ? (w.copyFrom==='cbd'?{league:store.league,scoring:store.scoring,slots:store.slots}:findMine(w.copyFrom))
    : null;
  const league=Object.assign({},LEAGUE_DEFAULTS,src?cp(src.league):{});
  const scoring=Object.assign({},SCORING_DEFAULTS,src?cp(src.scoring):{});
  const slots=Object.assign({},SLOT_DEFAULTS,src?cp(src.slots):{});
  league.type=w.type;
  league.teams=wizTeams();
  league.draftType=w.draftType;
  league.draftWhen=w.draftWhen;
  if(w.type==='dynasty')league.draftPool=w.startup==='rookies'?'rookies':'all';
  league.commish=MY_TEAM;
  const id='lg'+Date.now().toString(36);
  myLeagues().push({id,name:w.name.trim(),created:Date.now(),invite:inviteToken(),
                    joined:1,league,scoring,slots});
  delete store.createLeague;
  if(!store.leagueOrder)store.leagueOrder=[];
  store.leagueOrder.push(id);
  saveStore();
  goHome();
  if(window.openInvite)window.openInvite(id);
}

/** Abandon a part-finished league setup. */
export function wizReset(){delete store.createLeague;saveStore();renderWizard();}
