import { S } from './state.js';
import { LT } from './clock.js';
import { LG } from './data/league-config.js';
import { MY_TEAM, T } from './data/teams.js';
import { LIVE_WEEK, MINW, badge, seededScore } from './lineup.js';
import { escHtml } from './panel.js';

// ======================= MARIO KART SCORING =======================
// No schedule and no opponent. Everyone starts their best team, the week is
// ranked on points scored, and finishing position pays season points: first
// takes as many as there are teams, second one fewer, and so on down.
//
// That is why nothing here consults `scheduleForWeek` — in this mode there is
// no pairing to consult, which is the whole point of it.

export function kartOn(){return (LG().standings||'record')==='kart';}
export function fieldSize(){return Object.keys(T).length;}

/** One team's points for one week. The user's live week comes off the real
 *  lineup so it agrees with every other screen; the rest are seeded. */
export function weekScore(key,week){
  if(week===LIVE_WEEK&&key===MY_TEAM)return LT.a;
  return seededScore(week,key);
}
/** The week ranked, with the season points each finish earns. */
export function weekBoard(week){
  const n=fieldSize();
  return Object.keys(T)
    .map(k=>({k,pts:weekScore(k,week)}))
    .sort((a,b)=>b.pts-a.pts)
    .map((r,i)=>({...r,place:i+1,earned:Math.max(1,n-i)}));
}
/** Season points to date. Only weeks that have been played count. */
export function kartTable(){
  const totals={};
  Object.keys(T).forEach(k=>{totals[k]={k,pts:0,wins:0,best:null,scored:0};});
  for(let w=MINW;w<=LIVE_WEEK;w++){
    weekBoard(w).forEach(r=>{
      const t=totals[r.k];
      t.pts+=r.earned;t.scored+=r.pts;
      if(r.place===1)t.wins++;
      if(t.best==null||r.place<t.best)t.best=r.place;
    });
  }
  return Object.values(totals)
    .map(t=>({...t,scored:Math.round(t.scored*10)/10}))
    .sort((a,b)=>b.pts-a.pts||b.scored-a.scored);
}

// ---- the Week tab ----
export function renderKartWeek(){
  const week=S.week,board=weekBoard(week),played=week<=LIVE_WEEK;
  // there are no matchups to list when nobody has an opponent
  const all=document.getElementById('mAllBtn');
  if(all)all.style.display='none';
  const hero=document.getElementById('userHero');
  hero.className='';
  hero.innerHTML='';
  document.getElementById('userRewind').style.display='none';
  const mine=board.find(r=>r.k===MY_TEAM)||{place:'—',earned:0,pts:0};
  document.getElementById('userLineup').innerHTML=`
    <div class="kt-top">
      <div class="kt-place"><span class="k">YOUR FINISH</span><b>${played?ordinal(mine.place):'—'}</b></div>
      <div class="kt-place"><span class="k">POINTS</span><b>${played?mine.earned:0}</b></div>
      <div class="kt-place"><span class="k">SCORED</span><b>${(mine.pts||0).toFixed(1)}</b></div>
    </div>
    <div class="hd"><span>Week ${week} · Finish order</span></div>
    <div class="kt">${board.map(r=>{
      const t=T[r.k],me=r.k===MY_TEAM;
      return `<div class="kt-row${me?' me':''}${r.place<=3?' pod':''}" onclick="openTeam('${r.k}')">
        <span class="kt-p">${r.place}</span>
        ${badge(t,'kt-bd')}
        <div class="kt-nm"><div class="n tf-${r.k}">${escHtml(t.n)}</div><div class="m">${escHtml(t.mgr)}</div></div>
        <span class="kt-sc">${r.pts.toFixed(1)}</span>
        <span class="kt-earn">${played?'+'+r.earned:'—'}</span>
      </div>`;
    }).join('')}</div>`;
}
function ordinal(n){
  if(typeof n!=='number')return n;
  const s=['th','st','nd','rd'],v=n%100;
  return n+(s[(v-20)%10]||s[v]||s[0]);
}

// ---- the League tab ----
export function renderKartStandings(){
  const rows=kartTable();
  const head=`<div class="stand-row head">
    <div class="stand-c1">TEAM</div>
    <span class="st-c rec">WINS</span>
    <span class="st-c pf">SCORED</span>
    <span class="st-c df">PTS</span>
  </div>`;
  document.getElementById('standBody').innerHTML=head+rows.map((r,i)=>{
    const t=T[r.k],me=r.k===MY_TEAM;
    return `<div class="stand-row ${me?'me':''}">
      <div class="stand-c1">
        <span class="stand-rk">${i+1}</span>${badge(t,'stand-bd')}
        <div class="stand-nm"><div class="n tf-${r.k} ${me?'me':''}" style="cursor:pointer" onclick="openTeam('${r.k}')">${escHtml(t.n)}</div><div class="m">${escHtml(t.mgr)}</div></div>
      </div>
      <span class="st-c rec">${r.wins}</span>
      <span class="st-c pf">${r.scored.toFixed(1)}</span>
      <span class="st-c df"><b>${r.pts}</b></span>
    </div>`;
  }).join('');
}
