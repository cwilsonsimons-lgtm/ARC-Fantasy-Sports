import { S } from './state.js';
import { LT, SLOT_ELIG, isLocked, ordLabel, recomputeLT, simKick, simStops, slotAllows } from './clock.js';
import { invalidateRosters, persistRoster } from './freeagency.js';
import { stadiumStageHTML } from './hero.js';
import { LIVE_WEEK, MINW, fullStartersHTML } from './lineup.js';
import { medianStripHTML } from './median.js';
import { bindVs, toast } from './nav.js';
import { buildRewind, rwOpen, syncRewind } from './rewind.js';
import { BENCH, LINEUP, saveStore, store } from './store.js';
import { renderWeek } from './week.js';

// ---------- USER MATCHUP (week aware) ----------
export function renderUserMatchup(){
  const live=S.week===LIVE_WEEK;
  if(live)recomputeLT();
  const uHero=document.getElementById('userHero'),uRw=document.getElementById('userRewind'),uLine=document.getElementById('userLineup');

  // resolve this week's teams/scores (pandas always on the left)
  let aK,xK,as,xs,aw,xw,ap=null,xp=null;
  if(live){aK='pandas';xK='radiator';as=LT.a;xs=LT.x;aw=LT.aw;xw=LT.xw;ap=LT.ap;xp=LT.xp;}
  else{
    const g=S.games.find(x=>x.me);
    aK=g.a;xK=g.x;as=g.as;xs=g.xs;aw=g.aw;xw=g.xw;
    if(g.x==='pandas'){aK=g.x;xK=g.a;as=g.xs;xs=g.as;aw=g.xw;xw=g.aw;}
    if(S.week>LIVE_WEEK){   // nothing played: show projected totals under the logos
      ap=LINEUP.reduce((n,r)=>n+(r.a?r.a.proj:0),0);
      xp=LINEUP.reduce((n,r)=>n+(r.x?r.x.proj:0),0);
      if(ap||xp){aw=Math.max(1,Math.min(99,Math.round(50+(ap-xp)*1.3)));xw=100-aw;}
    }
  }

  const sk=live?simKick():null;
  const phase=live?(sk<0?'pre':(!isFinite(sk)?'final':'live')):null;
  // Rewind is available on every matchup, matching the detail view, which has
  // always wired it unconditionally. This used to read `S.week <= LIVE_WEEK`,
  // but LIVE_WEEK is 0 while weeks run from MINW (1), so it was never true and
  // the scrubber was silently dead on this tab.
  const canRewind = S.week >= MINW;
  uHero.className='';
  uHero.innerHTML=stadiumStageHTML(aK,xK,as,xs,aw,xw,ap,xp,{phase:phase,rewind:canRewind?'userRewind':null});
  bindVs(uHero.querySelector('[data-vs]'));

  // Rewind: no button — tapping either win% number or the win bar in the hero reveals it
  if(canRewind){ buildRewind(uRw,as,xs); syncRewind('userRewind'); }
  else { rwOpen.userRewind=false; uRw.style.display='none'; }

  // lineup, under both of the week's results when the league plays the median
  const med=medianStripHTML(aK,xK,S.week);
  if(live){uLine.innerHTML=med+phaseStepperHTML()+fullStartersHTML({phased:true,editable:true});}
  else if(S.week>LIVE_WEEK&&S.week===MINW){
    // preseason: the Week 1 matchup is the landing screen, slots sit empty until the draft
    uLine.innerHTML=med+fullStartersHTML({phased:false,editable:true});
  }
  else{
    const g=S.games.find(x=>x.me),idx=S.games.indexOf(g);
    const note=S.week<LIVE_WEEK?'Final result · open for Rewind':'Scheduled · projections only';
    uLine.innerHTML=med+`<div class="activity" onclick="openDetail(${idx})" style="margin-top:12px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6M7 12h10M7 16h10"/></svg>
      <div class="t"><div class="a">View Full Matchup</div><div class="b">${note}</div></div><div class="arr">›</div></div>`;
  }
}
// ---- simulated week clock: stepper + lineup editing ----
export function phaseStepperHTML(){
  const stops=simStops(),i=store.simIdx,sk=simKick();
  const atStart=i<=-1,atEnd=i>=stops.length;
  const locked=LINEUP.reduce((n,r)=>n+(isLocked(r.a)?1:0),0);
  const sub=i<0?'Lineups open · swap freely before kickoff'
    :(!isFinite(sk)?'All games final':`${locked} of ${LINEUP.length} starters locked`);
  return `<div class="phasebar">
    <div class="ph-ar ${atStart?'dis':''}" onclick="stepSim(-1)">‹</div>
    <div class="ph-mid"><div class="ph-lbl">${ordLabel(sk)}</div><div class="ph-sub">${sub}</div></div>
    <div class="ph-ar ${atEnd?'dis':''}" onclick="stepSim(1)">›</div>
  </div>`;
}
export function stepSim(d){
  const stops=simStops();let i=store.simIdx+d;
  i=Math.max(-1,Math.min(stops.length,i));
  store.simIdx=i;saveStore();recomputeLT();renderWeek();
}
export let swapIdx=null;
export function openSwap(i){
  const r=LINEUP[i];if(!r)return;
  if(r.a&&isLocked(r.a)){toast('Locked — game already started');return;}
  swapIdx=i;const slot=r.slot,cur=r.a;
  const open=[],locked=[];
  BENCH.forEach((br,j)=>{const p=br.a;if(!p||p.fa||!slotAllows(slot,p.pos))return;(isLocked(p)?locked:open).push({p,j});});
  let body=`<div class="swap-cur">${cur?`Sit <b>${cur.n}</b> · start`:`Fill <b>${slot}</b> ·`} a ${SLOT_ELIG[slot].join('/')} from your bench</div>`;
  if(!open.length&&!locked.length) body+=`<div class="swap-empty">No eligible bench players for this slot.<br>Open the ☰ menu → <b>Available</b> to add a free agent.</div>`;
  body+=open.map(({p,j})=>`<div class="swap-row" onclick="doSwap(${i},${j})">
    <div class="swap-pos">${p.pos}</div>
    <div class="swap-nm"><div class="n">${p.n}${p.tag?` <span class="tag">${p.tag}</span>`:''}</div><div class="m">${p.tm}${p.bye?` (${p.bye})`:''} · ${p.g||'—'}</div></div>
    <div class="swap-pts">${p.proj.toFixed(1)}</div></div>`).join('');
  body+=locked.map(({p})=>`<div class="swap-row dis">
    <div class="swap-pos">${p.pos}</div>
    <div class="swap-nm"><div class="n">${p.n}</div><div class="m">Locked · ${p.g}</div></div>
    <div class="swap-pts">${p.proj.toFixed(1)}</div></div>`).join('');
  document.getElementById('swapTitle').textContent=cur?`Swap ${slot}`:`Fill ${slot}`;
  document.getElementById('swapBody').innerHTML=body;
  document.getElementById('swapScrim').classList.add('show');
  document.getElementById('swapSheet').classList.add('show');
}
// tapping a BN badge: pick which starting slot this bench player moves into
export function openBenchSwap(j){
  const p=BENCH[j]&&BENCH[j].a;if(!p)return;
  if(isLocked(p)){toast('Locked — game already started');return;}
  swapIdx=null;
  const open=[],locked=[];
  LINEUP.forEach((r,i)=>{if(!slotAllows(r.slot,p.pos))return;(r.a&&isLocked(r.a)?locked:open).push({r,i});});
  let body=`<div class="swap-cur">Start <b>${p.n}</b> · pick a ${p.pos}-eligible slot</div>`;
  if(!open.length&&!locked.length) body+=`<div class="swap-empty">No starting slot accepts a ${p.pos}.</div>`;
  body+=open.map(({r,i})=>`<div class="swap-row" onclick="doSwap(${i},${j})">
    <div class="swap-pos">${r.slot}</div>
    <div class="swap-nm"><div class="n">${r.a?r.a.n:'Empty'}</div><div class="m">${r.a?`${r.a.pos} · ${r.a.tm} · sits`:'Open slot'}</div></div>
    <div class="swap-pts">${r.a?r.a.proj.toFixed(1):'—'}</div></div>`).join('');
  body+=locked.map(({r})=>`<div class="swap-row dis">
    <div class="swap-pos">${r.slot}</div>
    <div class="swap-nm"><div class="n">${r.a.n}</div><div class="m">Locked · ${r.a.g}</div></div>
    <div class="swap-pts">${r.a.proj.toFixed(1)}</div></div>`).join('');
  document.getElementById('swapTitle').textContent=`Start ${p.pos}`;
  document.getElementById('swapBody').innerHTML=body;
  document.getElementById('swapScrim').classList.add('show');
  document.getElementById('swapSheet').classList.add('show');
}
export function closeSwap(){document.getElementById('swapScrim').classList.remove('show');document.getElementById('swapSheet').classList.remove('show');swapIdx=null;}
export function doSwap(i,j){
  const starter=LINEUP[i].a,benchP=BENCH[j].a;
  if(!benchP)return;
  if((starter&&isLocked(starter))||isLocked(benchP)){toast('Locked — game already started');closeSwap();return;}
  LINEUP[i].a=benchP;BENCH[j].a=starter||null;
  S.pidx=null;invalidateRosters();persistRoster();closeSwap();recomputeLT();renderWeek();
  toast(`${benchP.n} is now starting`);
}
