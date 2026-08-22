import { S } from './state.js';
import { ICON_LOCK, ICON_SWAP, LT, isLocked, onField, pLive, simKick } from './clock.js';
import { T } from './data/teams.js';
import { MAXW, MINW, scheduleForWeek } from './data/schedule.js';
import { stadiumHeroHTML } from './hero.js';
import { renderUserMatchup } from './matchup.js';
import { showTab } from './nav.js';
import { pKeyOf } from './player.js';
import { BENCH, GAMES, IR, LINEUP, TAXI, markInner } from './store.js';
import { esc } from './team.js';
// esc() escapes for inline JS handlers; team names rendered as text need
// HTML escaping instead, or an apostrophe shows up as \'
import { escHtml } from './panel.js';

// ---------- RENDER ----------
export const badge=(t,cls)=>`<span class="${cls}" style="background:${t.bg};color:${t.c};overflow:hidden">${markInner(t)}</span>`;

// ----- week engine state -----
// LIVE_WEEK 0 = nothing has kicked off yet (preseason)
// Week 1 is the live week. This was 0 while weeks run from MINW (1), so
// `week === LIVE_WEEK` was never true and the whole live-scoring path was
// unreachable: the hero showed 0.0-0.0 no matter how far the game clock was
// stepped, and the Rewind scrubber interpolated between zeroes.
export const LIVE_WEEK=1;
// Week count and the round-robin itself live in data/schedule.js, which the
// matchup-graphic builder also reads. Re-exported here so every existing
// importer keeps getting them from lineup.js.
export { MINW, MAXW, scheduleForWeek };


export function gameClock(name){
  if(onField(name)==='off')return 'Final';
  let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;
  return 'Q'+(1+h%4)+' '+(h%15)+':'+String((h%6)*10).padStart(2,'0');
}
// one player's name/meta block (or "Empty")
export function sideCell(p){
  if(!p)return `<div class="st-nm"><div class="n empty">Empty</div></div>`;
  const dim=p.fa?' style="color:var(--ink-3)"':'';
  const l1=`${p.pos} · ${p.tm}${p.bye?` (${p.bye})`:''}${p.tag?` <span class="tag">${p.tag}</span>`:''}`;
  const nm=`<span class="pk" onclick="event.stopPropagation();openPlayer('${esc(pKeyOf(p))}')">${p.n}</span>`;
  return `<div class="st-nm"><div class="n"${dim}>${nm}</div><div class="m">${l1}</div>${p.g?`<div class="g2">${p.g}</div>`:''}</div>`;
}
export function scoreCell(p,phased){
  if(!p)return `<div class="st-pts">—</div>`;
  if(phased){
    const locked=isLocked(p),pts=locked?pLive(p.proj,p.n):0;
    return `<div class="st-pts${locked?'':' pre'}">${pts.toFixed(1)}<div class="pj">${p.proj.toFixed(1)}</div></div>`;
  }
  return `<div class="st-pts">${pLive(p.proj,p.n).toFixed(1)}<div class="pj">${p.proj.toFixed(1)}</div></div>`;
}
// shared head-to-head row: both teams side by side, badge pinned center.
// opts: {phased} phase-aware scores; {editIdx} makes MY (a) starter tappable to swap (or shows a lock)
// the center slot badge is the ONLY swap control. player names open the player card.
// opts: {phased} phase-aware scores; {editIdx} starter slot i is tappable to swap;
//       {benchIdx} bench spot j is tappable to move that player into the lineup
export function hhRow(a,x,badge,opts){
  opts=opts||{};
  const aSide=`<div class="st-side">${sideCell(a)}</div>`;
  let posCell=`<div class="st-pos">${badge}</div>`;
  if(opts.editIdx!=null){
    if(a&&isLocked(a))
      posCell=`<div class="st-pos lockslot" onclick="openSwap(${opts.editIdx})">${badge}<span class="slotmk">${ICON_LOCK}</span></div>`;
    else{
      const mk=a?`<span class="slotmk">${ICON_SWAP}</span>`:`<span class="slotmk plus">＋</span>`;
      posCell=`<div class="st-pos tapslot" onclick="openSwap(${opts.editIdx})">${badge}${mk}</div>`;
    }
  } else if(opts.benchIdx!=null&&a){
    if(isLocked(a))
      posCell=`<div class="st-pos lockslot" onclick="openBenchSwap(${opts.benchIdx})">${badge}<span class="slotmk">${ICON_LOCK}</span></div>`;
    else
      posCell=`<div class="st-pos tapslot" onclick="openBenchSwap(${opts.benchIdx})">${badge}<span class="slotmk">${ICON_SWAP}</span></div>`;
  }
  return `<div class="st-row">
    ${aSide}
    ${scoreCell(a,opts.phased)}
    ${posCell}
    ${scoreCell(x,opts.phased)}
    <div class="st-side opp">${sideCell(x)}</div>
  </div>`;
}
export function lineupRow(r,i,opts){opts=opts||{};return hhRow(r.a,r.x,r.slot,{phased:opts.phased,editIdx:opts.editable?i:null});}
// a bench/IR/taxi section with a single title label (no My Team/Opponent header)
// editable=true on Bench makes each BN badge tap open "start this player"
export function reserveSection(title,rows,badge,phased,editable){
  let h=`<div class="starters" style="margin-top:12px"><div class="st-hd"><span class="g">${title}</span><span></span></div>`;
  if(rows.some(r=>r.a||r.x)) h+=rows.map((r,j)=>hhRow(r.a,r.x,badge,{phased,benchIdx:editable?j:null})).join('');
  else h+=`<div class="bnch-empty">${title} · Empty</div>`;
  return h+`</div>`;
}
export function _legacyBench(title,list){
  return `<div class="starters" style="margin-top:12px"><div class="st-hd"><span class="g">${title}</span><span></span></div>`+
    list.map(p=>`<div class="bnch-row">
      <span class="st-pos" style="width:40px">${p.pos}</span>
      <div class="bnch-nm"><div class="n">${p.n}${p.tag?` <span class="tag">${p.tag}</span>`:''}</div>
        <div class="m">${p.tm} · ${gameClock(p.n)}</div></div>
      <div class="bnch-pts">${pLive(p.proj,p.n).toFixed(1)}<div class="pj">${p.proj.toFixed(1)}</div></div>
    </div>`).join('')+`</div>`;
}
export function fullStartersHTML(opts){
  opts=opts||{};
  const ph=opts.phased,ed=opts.editable;
  let h=`<div class="starters"><div class="st-hd"><span class="g">Starters</span><span></span></div>`;
  h+=LINEUP.map((r,i)=>lineupRow(r,i,{phased:ph,editable:ed})).join('')+`</div>`;
  if(BENCH.length)h+=reserveSection('Bench',BENCH,'BN',ph,ed);
  if(IR.length)h+=reserveSection('Injured Reserve',IR,'IR',ph);
  if(TAXI.length)h+=reserveSection('Taxi Squad',TAXI,'TX',ph);
  return h;
}
// detail view (drilled in from All Matchups) shows the exact same body as the Matchup tab
export function detailStartersHTML(){return fullStartersHTML();}

export function seededScore(week,key){
  if(week>LIVE_WEEK)return 0;   // preseason / upcoming: nothing played yet
  let h=2166136261;const s=key+'#'+week;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return Math.round((85+((h>>>0)%700)/10)*10)/10;
}
export function getGames(week){
  if(week===LIVE_WEEK) return GAMES.map(g=>{
    const base={...g,status:g.live?'live':'final'};
    // user's live game: single source of truth = LT (the actual lineup sum), so
    // the All Matchups card + Detail view match the Matchup-tab hero exactly
    if(g.me){base.as=LT.a;base.xs=LT.x;base.aw=LT.aw;base.xw=LT.xw;
      const sk=simKick();base.status=sk<0?'sched':(!isFinite(sk)?'final':'live');}
    return base;
  });
  const games=scheduleForWeek(week).map(([k1,k2])=>{
    let a=k1,x=k2; if(k2==='pandas'){a=k2;x=k1;}
    const as=seededScore(week,a),xs=seededScore(week,x);
    const aw=(as||xs)?Math.max(1,Math.min(99,Math.round(50+(as-xs)*1.3))):50;
    return {a,x,as,xs,aw,xw:100-aw,me:(a==='pandas'||x==='pandas'),status:week<LIVE_WEEK?'final':'sched'};
  });
  games.sort((p,q)=>(q.me?1:0)-(p.me?1:0));
  return games;
}

/** Compact matchup cards for the League tab, sitting above the standings.
 *
 *  Deliberately much smaller than the stadium cards in All Matchups and than the
 *  detail view a tap opens: this is a glance at the week, not the destination.
 *  Scores stay dashes until a game has started, so an unplayed week does not
 *  read as a 0-0 result. */
/** Season points for / against, from the same seeded scores the matchups use.
 *  Unplayed weeks score 0, so these read 0.0 until games are played. */
export function seasonTotals(key){
  let pf=0,pa=0;
  for(let w=MINW;w<=MAXW;w++){
    const pair=scheduleForWeek(w).find(p=>p.indexOf(key)>-1);
    if(!pair)continue;
    const opp=pair[0]===key?pair[1]:pair[0];
    pf+=seededScore(w,key);
    pa+=seededScore(w,opp);
  }
  return {pf:Math.round(pf*10)/10, pa:Math.round(pa*10)/10};
}
export function renderStandingsMatchups(){
  const el=document.getElementById('standMatchups'); if(!el)return;
  el.innerHTML = S.games.map((g,i)=>{
    const openClick = g.me ? "openMyMatchup()" : `openDetail(${i})`;
    const st = g.status==='live' ? {c:'live',t:'LIVE'}
             : g.status==='final' ? {c:'final',t:'FINAL'}
             : {c:'sched',t:'WK '+S.week};
    const played = g.status!=='sched';
    const row=(k,score,win)=>`<div class="sm-tr${win?' w':''}">
      ${badge(T[k],'sm-bd')}
      <div class="sm-nm tf-${k}">${escHtml(T[k].n)}</div>
      <div class="sm-pt">${(+score).toFixed(1)}</div>
    </div>`;
    return `<div class="sm-card${g.me?' me':''}" onclick="${openClick}">
      <div class="sm-st ${st.c}">${st.t}</div>
      <div class="sm-teams">
        ${row(g.a,g.as,played&&g.as>g.xs)}
        ${row(g.x,g.xs,played&&g.xs>g.as)}
      </div>
      <div class="sm-arr">&rsaquo;</div>
    </div>`;
  }).join('');
}
export function renderLeagueBody(){
  document.getElementById('leagueBody').innerHTML = S.games.map((g,i)=>{
    const openClick = g.me ? "openMyMatchup()" : `openDetail(${i})`;
    const status = g.status==='live'?{cls:'live',txt:'LIVE'}
                 : g.status==='final'?{cls:'final',txt:'FINAL'}
                 : {cls:'sched',txt:'UPCOMING'};
    const ap = g.me ? LT.ap : null, xp = g.me ? LT.xp : null;  // projected only where we have lineup data
    return `<div class="lg-hero" onclick="${openClick}">
      ${stadiumHeroHTML(g.a,g.x,g.as,g.xs,g.aw,g.xw,ap,xp,{compact:true,status:status})}
    </div>`;
  }).join('');
}
// tapping your own game in All Matchups behaves exactly like tapping the Matchup tab
// (keeps your compact/full choice, seg toggle, rewind, etc.)
export function openMyMatchup(){renderUserMatchup();showTab('matchup');}
