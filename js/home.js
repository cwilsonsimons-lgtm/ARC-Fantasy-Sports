import { S } from './state.js';
import { POOL } from './clock.js';
import { seededPts } from './panel.js';
import { stadiumHeroHTML, stadiumStageHTML } from './hero.js';
import { countdownParts, draftAt, leagueMark, leagueScore, leagueStatus, leagueWeek,
         myKeyOf, openLeague, orderedLeagues, setLeagueOrder, teamsOf } from './leagues.js';
import { escHtml } from './panel.js';
import { markInner, saveStore, store } from './store.js';
import { showView } from './nav.js';

// ======================= HOME HUB =======================
// The root view, above league scope. It carries no league chrome of its own —
// `.leaguebar` and `.tabs` are hidden here, and the league's name only appears
// once you are inside one.

const GRIP='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

function typeLabel(lg){return lg.type==='dynasty'?'Dynasty':'Redraft';}
function statusLine(lg){
  const st=leagueStatus(lg),bits=[typeLabel(lg),lg.teamCount+' teams'];
  if(st==='predraft')bits.push('Pre-draft');
  else if(st==='complete')bits.push(lg.placed?ordinal(lg.placed)+' place':'Final');
  else bits.push('Week '+leagueWeek(lg));
  return bits.join(' · ');
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}

function countdownHTML(lg){
  const c=countdownParts(draftAt(lg)-Date.now());
  return `<div class="hb-clock">
    <span class="hb-cd"><b>${c.d}</b>d</span><span class="hb-cd"><b>${c.h}</b>h</span><span class="hb-cd"><b>${c.m}</b>m</span>
  </div>`;
}
function scoreHTML(lg){
  const sc=leagueScore(lg);
  if(!sc)return '';
  const teams=sc.teams,opp=teams[sc.opp];
  const lead=sc.ms>sc.os?' up':sc.ms<sc.os?' down':'';
  return `<div class="hb-score">
    <div class="hb-line${lead}">${sc.ms.toFixed(1)}<span>–</span>${sc.os.toFixed(1)}</div>
    <div class="hb-opp">${opp?escHtml(opp.n):''}</div>
  </div>
  <div class="hb-pct${lead}">${sc.mw}%</div>`;
}

function rowHTML(lg){
  const mk=leagueMark(lg),teams=teamsOf(lg),me=teams&&teams[myKeyOf(lg)];
  const tint=me?me.c:'var(--accent)',bgc=me?me.bg:'#171429';
  const right=leagueStatus(lg)==='predraft'?countdownHTML(lg):scoreHTML(lg);
  return `<div class="hb-row" data-league="${lg.id}" onclick="openLeague('${lg.id}')">
    <div class="hb-grip" data-grip>${GRIP}</div>
    <div class="hb-crest" style="background:linear-gradient(155deg,${bgc},#0b0e14);border-color:${tint};color:${tint}">${markInner(mk)}</div>
    <div class="hb-id">
      <div class="hb-nm">${escHtml(lg.name)}</div>
      <div class="hb-st">${escHtml(statusLine(lg))}</div>
    </div>
    ${right}
  </div>`;
}

export function renderHome(){
  const el=document.getElementById('homeBody');if(!el)return;
  el.innerHTML=`<div class="hb-list" id="hbList">${orderedLeagues().map(rowHTML).join('')}</div>`;
  bindReorder(document.getElementById('hbList'));
  startClock();
}

// ---- drag to reorder ----
// Pointer events rather than HTML5 drag: the latter never fires on touch.
// The handle is the only drag target, so a normal tap anywhere else still opens
// the league.
function bindReorder(list){
  if(!list)return;
  list.querySelectorAll('[data-grip]').forEach(grip=>{
    grip.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      const row=grip.closest('.hb-row'),rows=[...list.querySelectorAll('.hb-row')];
      const h=row.getBoundingClientRect().height+10;   // row height + gap
      const startY=e.clientY,startIdx=rows.indexOf(row);
      let idx=startIdx;
      row.classList.add('hb-drag');
      list.classList.add('hb-reorder');
      const move=ev=>{
        const dy=ev.clientY-startY;
        row.style.transform=`translateY(${dy}px)`;
        const want=Math.max(0,Math.min(rows.length-1,startIdx+Math.round(dy/h)));
        if(want!==idx){
          idx=want;
          const order=rows.filter(r=>r!==row);
          order.splice(idx,0,row);
          order.forEach((r,i)=>{if(r!==row)r.style.transform=`translateY(${(order.indexOf(r)-rows.indexOf(r))*h}px)`;});
        }
      };
      const up=()=>{
        window.removeEventListener('pointermove',move);
        window.removeEventListener('pointerup',up);
        window.removeEventListener('pointercancel',up);
        const order=rows.filter(r=>r!==row);
        order.splice(idx,0,row);
        setLeagueOrder(order.map(r=>r.dataset.league));
        list.classList.remove('hb-reorder');
        row.classList.remove('hb-drag');
        rows.forEach(r=>{r.style.transform='';});
        renderHome();
      };
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',up);
      window.addEventListener('pointercancel',up);
    });
  });
}

// A pre-draft row counts down, so the hub repaints while it is the visible view.
let hubTimer=null;
function startClock(){
  if(hubTimer)clearInterval(hubTimer);
  hubTimer=setInterval(()=>{
    const v=document.querySelector('.view[data-view="home"].on');
    if(!v){clearInterval(hubTimer);hubTimer=null;return;}
    document.querySelectorAll('.hb-row').forEach(r=>{
      const lg=orderedLeagues().find(l=>l.id===r.dataset.league);
      if(!lg||leagueStatus(lg)!=='predraft')return;
      const c=countdownParts(draftAt(lg)-Date.now()),b=r.querySelectorAll('.hb-cd b');
      if(b.length===3){b[0].textContent=c.d;b[1].textContent=c.h;b[2].textContent=c.m;}
    });
  },30000);
}

// ======================= SEEDED LEAGUES =======================
// The three leagues that are not City Boys Dynasty carry their own teams and
// scores and nothing writes back into them. They reuse the same stage, card and
// standings renderers, handed their own team map.

export function seededRoster(lg,key){
  const keys=Object.keys(teamsOf(lg)),k=keys.length||1;
  const ti=Math.max(0,keys.indexOf(key)),out=[];
  for(let i=ti;i<POOL.length&&out.length<14;i+=k){
    const p=POOL[i];
    out.push({id:p.id,n:p.n,pos:p.pos,tm:p.tm,proj:seededPts(leagueWeek(lg),p.n+key+lg.id,p.pos),
      group:out.length<9?'STARTERS':'BENCH'});
  }
  return out;
}
/** Every other pairing that week, so the league reads as a league. */
export function seededGames(lg){
  const keys=Object.keys(teamsOf(lg)),sc=leagueScore(lg),out=[];
  const rest=keys.filter(k=>k!==sc.me&&k!==sc.opp);
  out.push({a:sc.me,x:sc.opp,as:sc.ms,xs:sc.os,aw:sc.mw,xw:100-sc.mw,me:true});
  for(let i=0;i+1<rest.length;i+=2){
    const a=rest[i],x=rest[i+1];
    const as=Math.round((60+hash(lg.id+a+lg.week)%800/10)*10)/10;
    const xs=Math.round((60+hash(lg.id+x+lg.week)%800/10)*10)/10;
    const aw=Math.max(1,Math.min(99,Math.round(50+(as-xs)*1.3)));
    out.push({a,x,as,xs,aw,xw:100-aw,me:false});
  }
  return out;
}
function hash(s){let h=2166136261;s=String(s);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0);}

export function renderSeededLeague(lg){
  const teams=teamsOf(lg),sc=leagueScore(lg),st=leagueStatus(lg);
  const wkLabel=st==='predraft'?'PRE-DRAFT':st==='complete'?'FINAL':'WEEK '+leagueWeek(lg);
  const phase=st==='complete'?'final':st==='predraft'?'pre':'live';
  const hero=document.getElementById('userHero');
  hero.className='';
  hero.innerHTML=stadiumStageHTML(sc.me,sc.opp,sc.ms,sc.os,sc.mw,100-sc.mw,null,null,
    {teams,seeded:true,phase,weekLabel:wkLabel});
  document.getElementById('userRewind').style.display='none';

  const games=seededGames(lg).slice(1);
  const cards=games.map(g=>`<div class="lg-hero" onclick="openSeededTeam('${lg.id}','${g.a}')">
    ${stadiumHeroHTML(g.a,g.x,g.as,g.xs,g.aw,g.xw,null,null,
      {teams,compact:true,status:{cls:st==='complete'?'final':'live',txt:st==='complete'?'FINAL':'LIVE'}})}
  </div>`).join('');

  const rows=Object.keys(teams).map(k=>{
    const t=teams[k],me=k===myKeyOf(lg);
    return `<div class="stand-row ${me?'me':''}" onclick="openSeededTeam('${lg.id}','${k}')">
      <div class="stand-c1">
        <span class="stand-rk">${t.rk}</span>
        <span class="stand-bd" style="background:${t.bg};color:${t.c}">${t.mono}</span>
        <div class="stand-nm"><div class="n ${me?'me':''}" style="color:${t.c}">${escHtml(t.n)}</div><div class="m">${escHtml(t.mgr)}</div></div>
      </div>
      <span class="st-c rec">${t.rec}</span>
    </div>`;
  }).join('');

  document.getElementById('userLineup').innerHTML=
    `<div class="hd" style="margin-top:14px"><span>${wkLabel==='FINAL'?'Final Week':'Week '+leagueWeek(lg)} · All Matchups</span></div>
     ${cards}
     <div class="hd"><span>League Standings</span></div>
     <div class="stand">${rows}</div>`;

  showView('matchup');
  document.getElementById('scroll').scrollTop=0;
}

/** Read-only roster for a seeded league, drawn in the existing team view. */
export function openSeededTeam(lgId,key){
  const lg=orderedLeagues().find(l=>l.id===lgId);if(!lg)return;
  const t=teamsOf(lg)[key];if(!t)return;
  S.teamBackView='seeded';
  S.seededBack=lg.id;
  document.getElementById('teamBackLabel').textContent=lg.name;
  const roster=seededRoster(lg,key);
  let body=`<div class="tv-head">
    <div class="tv-band" style="background:linear-gradient(90deg,${t.c},transparent)"></div>
    <div class="tv-top">
      <div class="tv-crest" style="background:linear-gradient(155deg,${t.bg},#171416);border:1.5px solid ${t.c};color:${t.c}">${t.mono}</div>
      <div class="tv-idwrap"><div class="tv-name" style="color:${t.c}">${escHtml(t.n)}</div>
        <div class="tv-sub">${escHtml(t.mgr)} · ${t.rec} · #${t.rk}</div></div>
    </div>
  </div>`;
  ['STARTERS','BENCH'].forEach(gp=>{
    const list=roster.filter(p=>p.group===gp);if(!list.length)return;
    body+=`<div class="tv-sec-hd">${gp}</div><div class="tv-roster">`+list.map(p=>`
      <div class="tv-row">
        <div class="tv-pinfo"><div class="tv-pn">${escHtml(p.n)}</div>
          <div class="tv-pmeta">${p.pos} · ${p.tm}</div></div>
        <div class="tv-pts">${p.proj.toFixed(1)}</div>
      </div>`).join('')+`</div>`;
  });
  document.getElementById('teamBody').innerHTML=body;
  showView('team');
  document.querySelectorAll('.tab').forEach(t2=>t2.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
}

export function initHome(){
  store.leagueOrder=store.leagueOrder||[];
  saveStore();
}
