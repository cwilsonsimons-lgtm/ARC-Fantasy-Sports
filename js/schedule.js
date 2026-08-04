import { S } from './state.js';
import { T } from './data/teams.js';
import { LIVE_WEEK } from './lineup.js';
import { fmtRecord, medianOn, recLabel, resultLabel, runningRecords, teamRecord } from './median.js';
import { showLeagueView, showTab, showView, toggleDrawer } from './nav.js';
import { escHtml } from './panel.js';
import { markInner } from './store.js';
import { currentViewName } from './team.js';

// ---------- TEAM SCHEDULE ----------
// Tapping a record anywhere it appears opens the season behind it: who they
// played each week, what the game finished, and how the running record got to
// where the matchup screen shows it. With the median on, each week carries its
// second result too - otherwise the running record would not add up.

export let scheduleKey=null;

function weekRow(r){
  const opp=T[r.opp]||{n:'—',mgr:'—',c:'var(--ink-3)',bg:'#151b26',mono:'?'};
  const live=r.week===LIVE_WEEK&&!r.played;
  const cls=r.h2h==='W'?'w':r.h2h==='L'?'l':'';
  const score=r.played?`${r.pts.toFixed(1)}–${r.oppPts.toFixed(1)}`:'—';
  const verdict=r.played?resultLabel[r.h2h]:(live?'In progress':'Scheduled');
  const med=medianOn()
    ? `<div class="sc-med">Median ${r.median?r.median.toFixed(1):'—'}
        <i class="med-chip ${r.med?r.med.toLowerCase():'none'}">${r.med||'—'}</i></div>`
    : '';
  return `<div class="sc-row${r.week===S.week?' now':''}">
    <div class="sc-wk">WK<b>${r.week}</b></div>
    <div class="sc-opp">
      <span class="sc-bd" style="background:${opp.bg};color:${opp.c}">${markInner(opp)}</span>
      <div class="sc-oppid">
        <div class="sc-vs">vs ${escHtml(opp.mgr)}</div>
        <div class="sc-tn tf-${r.opp}" style="color:${opp.c}">${escHtml(opp.n)}</div>
      </div>
    </div>
    <div class="sc-res">
      <div class="sc-verdict ${cls}">${verdict}</div>
      <div class="sc-score">${score}</div>
      ${med}
    </div>
    <div class="sc-run">
      <div class="sc-pts">${r.played?r.pts.toFixed(1):'—'}</div>
      <div class="sc-rec">${r.record||'—'}</div>
    </div>
  </div>`;
}
export function renderSchedule(key){
  scheduleKey=key;
  const t=T[key];if(!t)return;
  const rows=runningRecords(key);
  const h2h=teamRecord(key,{h2hOnly:true}),med=teamRecord(key,{medianOnly:true});
  const split=medianOn()
    ? `<div class="sc-split"><span>Head to head <b>${fmtRecord(h2h)}</b></span>
       <span>League median <b>${fmtRecord(med)}</b></span></div>`
    : '';
  document.getElementById('scheduleBody').innerHTML=`
    <div class="sc-head">
      <div class="sc-crest" style="background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${markInner(t)}</div>
      <div class="sc-id">
        <div class="sc-name tf-${key}" style="color:${t.c}">${escHtml(t.n)}</div>
        <div class="sc-sub">${escHtml(t.mgr)} · ${recLabel(key)} · #${t.rk}</div>
      </div>
    </div>
    ${split}
    <div class="sc-hd"><span>Week</span><span>Opponent</span><span>Result</span><span>Pts · Rec</span></div>
    <div class="sc-list">${rows.map(weekRow).join('')}</div>
    <div class="sc-note">${medianOn()
      ? 'Two results a week: the head-to-head game, and the league median. The running record counts both.'
      : 'One result a week. Turn on League Median in Settings ▸ General to play the league as a second opponent.'}</div>`;
}
export function openSchedule(key){
  if(!T[key])return;
  const cur=currentViewName();
  if(cur!=='schedule')S.scheduleBackView=cur;
  const lbl={league:'All matchups',standings:'Standings',detail:'Matchup',team:'Team'}[S.scheduleBackView]||'Matchup';
  document.getElementById('schedBackLabel').textContent=lbl;
  renderSchedule(key);
  showView('schedule');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
export function scheduleBack(){
  const v=S.scheduleBackView;
  if(v==='league')showLeagueView();
  else if(v==='standings')showTab('standings');
  else if(v==='team')showView('team');
  else if(v==='detail'){showView('detail');document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));document.getElementById('scroll').scrollTop=0;}
  else showTab('matchup');
}
