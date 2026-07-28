import { S } from './state.js';
import { recomputeLT } from './clock.js';
import { hydrateRosters } from './data/nfl-index.js';
import { LIVE_WEEK, MAXW, MINW, getGames, renderLeagueBody } from './lineup.js';
import { renderUserMatchup } from './matchup.js';
import { renderLeaders } from './panel.js';

// ---------- WEEK NAVIGATION ----------
export function renderWeek(){
  S.week=Math.max(MINW,Math.min(MAXW,S.week));
  recomputeLT();
  document.querySelectorAll('[data-weeklabel]').forEach(e=>e.textContent='Week '+S.week);
  const lb=document.querySelector('.league-id .wk');if(lb)lb.textContent='WEEK '+S.week;
  hydrateRosters(S.week);
  S.games=getGames(S.week);
  renderLeagueBody();renderUserMatchup();
  document.querySelectorAll('.ar').forEach(el=>{const s=+el.dataset.step;
    el.classList.toggle('dis',(s<0&&S.week<=MINW)||(s>0&&S.week>=MAXW));});
}
export function stepWeek(d){S.week+=d;renderWeek();}
export let pickerTarget='week';
export function buildWeekGrid(){
  const cur=pickerTarget==='leader'?S.leaderWeek:S.week;
  document.getElementById('weekGrid').innerHTML=Array.from({length:MAXW-MINW+1},(_,k)=>{
    const w=MINW+k,sub=w<LIVE_WEEK?'FINAL':w===LIVE_WEEK?'LIVE':'UPCOMING';
    return `<div class="wcell ${w===cur?'on':''} ${w===LIVE_WEEK&&w!==cur?'now':''}" onclick="pickWeek(${w})">${w}<span class="s">${sub}</span></div>`;
  }).join('');
}
export function openWeekPicker(target){pickerTarget=target||'week';buildWeekGrid();document.getElementById('sheetScrim').classList.add('show');document.getElementById('weekSheet').classList.add('show');}
export function closeWeekPicker(){document.getElementById('sheetScrim').classList.remove('show');document.getElementById('weekSheet').classList.remove('show');}
export function pickWeek(w){
  if(pickerTarget==='leader'){S.leaderWeek=w;S.leaderScope='week';renderLeaders();}
  else {S.week=w;renderWeek();}
  closeWeekPicker();
}
