import { S } from './state.js';
import { POOL, pLive } from './clock.js';
import { byeFor, gameLabel, pkey } from './data/nfl-index.js';
import { NFL_BY_ID, NFL_BY_NAME } from './data/nfl-players.js';
import { PLAYERS, curLeague } from './data/league-config.js';
import { MY_TEAM, T } from './data/teams.js';
import { canDraftNow, faOpen, freeAgents, isRostered } from './freeagency.js';
import { badge, seasonTotals } from './lineup.js';
import { escHtml } from './panel.js';
import { showLeagueView, showTab, showView, toggleDrawer } from './nav.js';
import { BENCH, LINEUP, TAXI, store } from './store.js';
import { ICON_CAM, collectSide, currentViewName, esc } from './team.js';

// ---------- PLAYER CARD ----------
export const POSCOLOR={QB:'#E65A9B',RB:'#4EC9A5',WR:'#5AA9E6',TE:'#E6A85A',K:'#C77DFF',DEF:'#8899A6'};
export function posColor(pos){return POSCOLOR[pos]||'#7C5CFF';}
export function seedHash(s){let h=2166136261;s=String(s);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0);}
export function rostPct(n){return 40+seedHash(n+'r')%60;}
export function posRankNo(n,pos){return 1+seedHash(n+pos)%36;}
// keyed by player, stored per LEAGUE — a photo or nickname given in one league
// shows anywhere that player appears in that league, and nowhere else
export function playerPhoto(name){const r=PLAYERS()[pkey(name)];return (r&&r.photo)||null;}
export function playerNick(name){const r=PLAYERS()[pkey(name)];return (r&&r.nick)||'';}
export function faceInner(key){
  const src=playerPhoto(key)||headshotFor(key);
  const rec=pIdx()[key];
  return src?`<img src="${src}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
            :initials((rec&&rec.n)||key);}
export function headshotFor(key){
  if(NFL_BY_ID[key])return NFL_BY_ID[key].hs||'';
  const r=pIdx()[key];
  if(r&&r.id&&NFL_BY_ID[r.id])return NFL_BY_ID[r.id].hs||'';
  const m=NFL_BY_NAME[key];return (m&&m.length===1&&m[0].hs)||'';}

// Every player is addressed by a stable key: the nflverse id when we have one,
// otherwise the display name (K/DEF and other legacy rows).
export function pKeyOf(p){return (p&&(p.id||p.n))||'';}
export function pIdx(){
  if(S.pidx)return S.pidx;
  S.pidx={};
  const put=p=>{
    if(!p||!p.n)return;
    const rec={id:p.id||null,n:p.n,full:p.full||p.n,pos:p.pos,tm:p.tm,num:p.num,exp:p.exp,hs:p.hs,
      bye:p.bye!=null?p.bye:byeFor(p.tm),proj:p.proj,g:p.g||gameLabel(p.tm,S.week),tag:p.tag,adp:p.adp};
    const k=pKeyOf(p);
    if(k&&!S.pidx[k])S.pidx[k]=rec;
    if(!S.pidx[p.n])S.pidx[p.n]=rec;   // bare-name lookups still resolve, first match wins
  };
  LINEUP.forEach(r=>{put(r.a);put(r.x);});BENCH.forEach(r=>{put(r.a);put(r.x);});TAXI.forEach(r=>{put(r.a);put(r.x);});
  POOL.forEach(put);
  return S.pidx;
}
export function findPlayer(key){return pIdx()[key]||{n:key,pos:'',tm:'',proj:0};}
export function isMyPlayer(key){return collectSide('a').some(pp=>pKeyOf(pp)===key||pp.n===key);}

// Short lineup/scroller names → full names. Used ONLY for display on the player card;
// the short name stays the player's identity everywhere else (photos, nicknames, roster, serial).
export const FULL_NAMES={
  'J. Burrow':'Joe Burrow','J. Gibbs':'Jahmyr Gibbs','Q. Judkins':'Quinshon Judkins',
  'P. Nacua':'Puka Nacua','G. Pickens':'George Pickens','L. McConkey':'Ladd McConkey',
  'K. Pitts':'Kyle Pitts','T. Henderson':'TreVeyon Henderson','B. Aubrey':'Brandon Aubrey',
  'Eagles':'Philadelphia Eagles',
  'J. Hurts':'Jalen Hurts','J. Williams':'Javonte Williams','C. Hubbard':'Chuba Hubbard',
  'J. Jefferson':'Justin Jefferson','P. Washington':'Parker Washington','M. Pittman':'Michael Pittman',
  'S. LaPorta':'Sam LaPorta','E. McPherson':'Evan McPherson','Jets':'New York Jets',
  'B. Robinson':'Bijan Robinson',
  'D. Prescott':'Dak Prescott','D. Jones':'Daniel Jones','B. Young':'Bryce Young',
  'B. Tuten':'Bhayshul Tuten','R. Dowdle':'Rico Dowdle','T. Etienne':'Travis Etienne',
  'R. Stevenson':'Rhamondre Stevenson','M. Golden':'Matthew Golden','D. Metcalf':'DK Metcalf',
  'D. Kincaid':'Dalton Kincaid','O. Gadsden':'Oronde Gadsden','P. Freiermuth':'Pat Freiermuth',
  'J. Tonges':'Jake Tonges','J. Milroe':'Jalen Milroe','B. Mayfield':'Baker Mayfield',
  'O. Gordon':'Ollie Gordon','K. Johnson':'Kaleb Johnson','T. Spears':'Tyjae Spears',
  'M. Washington':'Malik Washington','L. McCaffrey':'Luke McCaffrey','K. Allen':'Keenan Allen',
  'T. Kelce':'Travis Kelce','D. Goedert':'Dallas Goedert','T. Loop':'Tyler Loop',
  'Jaguars':'Jacksonville Jaguars',
  'T. Benson':'Trey Benson','T. Johnson':'Theo Johnson','J. McMillan':'Jalen McMillan',
  'C. Beck':'Carson Beck',
  'J. Allen':'Josh Allen','L. Jackson':'Lamar Jackson','J. Daniels':'Jayden Daniels',
  'P. Mahomes':'Patrick Mahomes','S. Barkley':'Saquon Barkley','D. Henry':'Derrick Henry',
  'J. Mixon':'Joe Mixon','J. Jacobs':'Josh Jacobs','K. Walker':'Kenneth Walker',
  'A. St. Brown':'Amon-Ra St. Brown','C. Lamb':'CeeDee Lamb','J. Chase':"Ja'Marr Chase",
  'T. Hill':'Tyreek Hill','M. Nabers':'Malik Nabers','G. Kittle':'George Kittle',
  'T. McBride':'Trey McBride','B. Bowers':'Brock Bowers','T. Hockenson':'T.J. Hockenson',
};
// team-specific overrides for short names shared by two players (e.g. B. Robinson)
export const FULL_NAMES_TM={'B. Robinson|ATL':'Bijan Robinson','B. Robinson|WAS':'Brian Robinson'};
export function fullName(name,tm){
  if(tm&&FULL_NAMES_TM[name+'|'+tm])return FULL_NAMES_TM[name+'|'+tm];
  return FULL_NAMES[name]||name;
}
export function renderPlayer(key){
  const p=findPlayer(key),ac=posColor(p.pos);
  const name=p.n||key;
  const photo=playerPhoto(key),nick=playerNick(key);
  // real full name when the player came from the league data; legacy map otherwise
  const disp=p.full&&p.full!==p.n?p.full:fullName(name,p.tm);
  const parts=String(disp).split(' ');
  const first=parts.length>1?parts[0]:'';
  const last=parts.length>1?parts.slice(1).join(' '):parts[0];
  const rec=NFL_BY_ID[p.id]||null;
  const jersey=(rec&&rec.num)?rec.num:(seedHash(name)%99)+1;
  const cardNo=String(1+seedHash(String(key)+'c')%500).padStart(3,'0');
  const live=pLive(p.proj||0,name);
  const shot=photo||headshotFor(key);
  const hero=shot?`<img class="pc-img" src="${shot}" alt="" loading="lazy">`:`<div class="pc-noimg">${initials(name)}</div>`;
  const nickBanner=nick?`<div class="pc-nick">“${nick}”</div>`:'';
  const mine=isMyPlayer(key);
  const editHint=mine?`<div class="pc-edit" onclick="openTeam('${MY_TEAM}')">
      ${ICON_CAM}<div class="t"><b>CUSTOMIZE THIS CARD</b><br>${photo?'Update':'Add'} the PNG photo${nick?'':' & a nickname'} on your Team screen</div><div style="color:var(--ink-3)">›</div></div>`:'';
  const isFA=!mine&&faOpen()&&freeAgents('ALL').some(q=>pKeyOf(q)===key||q.n===name);
  const canTake=!mine&&canDraftNow(p.id);
  const dropBtn=mine?`<div class="pc-drop" onclick="confirmDrop('${esc(key)}')">Drop ${last} from roster</div>`
    :canTake?`<div class="pc-drop" style="border-color:var(--green);color:var(--green)" onclick="draftPlayer('${esc(p.id)}');showTab('draft')">Draft ${last}</div>`
    :(isFA?`<div class="pc-drop" style="border-color:rgba(124,92,255,.5);color:var(--violet)" onclick="addPlayer('${esc(key)}')">Add ${last} to your bench</div>`:'');
  document.getElementById('playerBody').innerHTML=`
    <div class="pc">
      <div class="pc-hero" style="--ac:${ac}">
        <div class="pc-wm">${jersey}</div>
        ${hero}
        <div class="pc-hero-grad"></div>
        <div class="badges"><span class="pc-posb" style="background:${ac}">${p.pos||'—'}</span><span class="pc-tm">${p.tm||''}${p.bye?` · BYE ${p.bye}`:''}</span></div>
        <div class="pc-fav">
          <div class="b" onclick="toast('Added to watchlist')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21Z"/></svg></div>
          <div class="b" onclick="toast('Compare')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg></div>
        </div>
        ${nickBanner}
        <div class="pc-name"><div class="pc-first">${first}</div><div class="pc-last">${last}</div></div>
      </div>
      <div class="pc-strip"><span>CARD <b>#${cardNo}</b> / 500</span><span>CITY BOYS DYNASTY · <b>'25</b></span></div>
      <div class="pc-stats">
        <div class="pc-stat"><div class="v" style="color:${ac}">${(p.proj||0).toFixed(1)}</div><div class="l">Proj</div></div>
        <div class="pc-stat"><div class="v">${live.toFixed(1)}</div><div class="l">FPTS</div></div>
        <div class="pc-stat"><div class="v">${p.pos||'—'}${posRankNo(name,p.pos)}</div><div class="l">Pos Rank</div></div>
        <div class="pc-stat"><div class="v">${rostPct(name)}%</div><div class="l">Rostered</div></div>
      </div>
      <div class="pc-week">
        <div><div class="k">This Week</div><div class="g">${p.g||'Scheduled'}</div></div>
        <div class="p" style="color:${ac}">${(p.proj||0).toFixed(1)}</div>
      </div>
      ${editHint}
      ${dropBtn}
    </div>`;
}
export let playerBackView='matchup';
export function openPlayer(key){
  S.currentPlayerName=key;
  const cur=currentViewName();
  if(cur!=='player') playerBackView=cur;
  const lbl={league:'All matchups',standings:'Standings',detail:'Matchup',team:'Team',player:'Back'}[playerBackView]||'Matchup';
  document.getElementById('playerBackLabel').textContent=lbl;
  renderPlayer(key);
  showView('player');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function playerBack(){
  const v=playerBackView;
  if(v==='team')showView('team');
  else if(v==='league')showLeagueView();
  else if(v==='standings')showTab('standings');
  else if(v==='detail'){showView('detail');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));document.getElementById('scroll').scrollTop=0;}
  else showTab('matchup');
}

// standings
// computed per render — T holds the ACTIVE league's teams, which can change
export function standOrder(){return Object.keys(T).sort((a,b)=>(T[a].rk||99)-(T[b].rk||99));}
export function renderStandings(){
  const col = k => `<span class="st-c ${k}">`;
  const head = `<div class="stand-row head">
    <div class="stand-c1">TEAM</div>
    <span class="st-c rec">W-L</span>
    <span class="st-c pf">PF</span>
    <span class="st-c pa">PA</span>
    <span class="st-c df">DIFF</span>
  </div>`;
  // a league that is still filling up shows who's in so far, plus the open seats
  const c=curLeague();
  const open=c?Math.max(0,(+c.league.teams||0)-Object.keys(c.teams||{}).length):0;
  const openNote=open?`<div class="stand-open">${open} open spot${open>1?'s':''} — waiting on managers to join</div>`:'';
  document.getElementById('standBody').innerHTML = head + standOrder().map(k=>{
    const t=T[k],me=k===MY_TEAM,tot=seasonTotals(k);
    const diff=Math.round((tot.pf-tot.pa)*10)/10;
    return `<div class="stand-row ${me?'me':''}">
      <div class="stand-c1">
        <span class="stand-rk">${t.rk}</span>${badge(t,'stand-bd')}
        <div class="stand-nm"><div class="n tf-${k} ${me?'me':''}" style="cursor:pointer" onclick="openTeam('${k}')">${escHtml(t.n)}</div><div class="m">${escHtml(t.mgr)}</div></div>
      </div>
      <span class="st-c rec">${t.rec}</span>
      <span class="st-c pf">${tot.pf.toFixed(1)}</span>
      <span class="st-c pa">${tot.pa.toFixed(1)}</span>
      <span class="st-c df ${diff>0?'pos':diff<0?'neg':''}">${diff>0?'+':''}${diff.toFixed(1)}</span>
    </div>`;
  }).join('')+openNote;
}


// leaders panel
// trending panel with position filter

export function posMatch(pos,f){if(f==='ALL')return true;if(f==='FLEX')return ['RB','WR','TE'].includes(pos);return pos===f;}
export function initials(n){const p=n.split(' ');return (p[0][0]+(p[1]?p[1][0]:'')).toUpperCase();}
export function trendRow(t){
  const add=(!faOpen()||isRostered(t.n))?'':`<span class="av-add" onclick="event.stopPropagation();addPlayer('${esc(t.n)}')">+</span>`;
  return `<div class="tr-row" onclick="openPlayer('${esc(t.n)}')">
    <span class="tr-rk">${t.rk}</span>
    <span class="tr-face">${faceInner(t.n)}</span>
    <div class="tr-info"><div class="tr-nm">${t.n}${t.rookie?'<span class="rk-badge">R</span>':''}</div>
      <div class="tr-mt"><span class="pos ${t.pos}">${t.pos}</span> · ${t.tm} · ${t.rost}% rost</div></div>
    <div class="tr-add">+${(t.add/1000).toFixed(1)}K<div class="tr-arrow">▲</div></div>
    ${add}
  </div>`;
}
