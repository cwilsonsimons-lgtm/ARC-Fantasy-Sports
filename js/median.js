import { LG } from './data/league-config.js';
import { T } from './data/teams.js';
import { MAXW, MINW, getGames } from './lineup.js';
import { escHtml } from './panel.js';

// ===== LEAGUE MEDIAN SCORING =====
//
// With the median on, every team plays two opponents a week: the one on their
// schedule, and the league itself. Score above the median and you bank a second
// win; below it, a second loss. A 10-team league therefore runs 2 results a
// week, and a season's records roughly double.
//
// Everything here is derived, never stored. Records are computed from the same
// scores the matchup cards draw, so turning the setting on or off re-reads the
// season rather than rewriting it - which is what makes the migration safe for
// leagues saved before the setting existed: they load with `median:0` and read
// exactly as they did before.

export function medianOn(){return !!(+LG().median);}

/** Every team's score for one week, from the same source the matchup cards use. */
export function weekScores(week){
  const out={};
  getGames(week).forEach(g=>{out[g.a]=+g.as;out[g.x]=+g.xs;});
  return out;
}
/** Has this game been decided? A scheduled week sits at 0.0-0.0 until it is played. */
function gamePlayed(g){return g.status!=='sched'&&(+g.as>0||+g.xs>0);}
/** Only the scores that exist. A game still to be played is not a zero. */
export function playedScores(week){
  const out={};
  getGames(week).forEach(g=>{if(gamePlayed(g)){out[g.a]=+g.as;out[g.x]=+g.xs;}});
  return out;
}
/** A week counts once anything in it has actually been scored. */
export function weekPlayed(week){return Object.keys(playedScores(week)).length>0;}
/** Middle score of the week; the average of the two middle teams when the count is even.
 *  Unplayed games are left out rather than counted as zeros, which would drag the
 *  median to the floor and hand a free win to everyone who has kicked off. */
export function leagueMedian(week){
  const v=Object.values(playedScores(week)).sort((a,b)=>a-b),n=v.length;
  if(!n)return 0;
  const m=n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2;
  return Math.round(m*10)/10;
}
export const resultLabel={W:'Won',L:'Lost',T:'Tied'};
function verdict(mine,theirs){return mine>theirs?'W':mine<theirs?'L':'T';}

/** One team's week: who they played, both results, and the median they were measured against. */
export function weekResult(key,week){
  const g=getGames(week).find(x=>x.a===key||x.x===key);
  if(!g)return null;
  const home=g.a===key;
  const pts=+(home?g.as:g.xs), oppPts=+(home?g.xs:g.as);
  const played=gamePlayed(g);
  const med=leagueMedian(week);
  return {
    week, opp:home?g.x:g.a, pts, oppPts, played,
    h2h:played?verdict(pts,oppPts):null,
    median:med,
    // a team is only measured against the median once their own game has been
    // played - before that there is no score of theirs to measure
    med:played?verdict(pts,med):null
  };
}
/** Every week of one team's season, oldest first. */
export function teamSchedule(key){
  const out=[];
  for(let w=MINW;w<=MAXW;w++){const r=weekResult(key,w);if(r)out.push(r);}
  return out;
}
/** W-L-T across the season: the head-to-head result, plus the median one when it is on. */
export function teamRecord(key,opts){
  opts=opts||{};
  const rec={w:0,l:0,t:0};
  const add=v=>{if(v==='W')rec.w++;else if(v==='L')rec.l++;else if(v==='T')rec.t++;};
  teamSchedule(key).forEach(r=>{
    if(!opts.medianOnly)add(r.h2h);
    if(medianOn()&&!opts.h2hOnly)add(r.med);
  });
  return rec;
}
export function fmtRecord(rec){return `${rec.w}-${rec.l}${rec.t?'-'+rec.t:''}`;}
/** The record shown everywhere a team's W-L appears. */
export function recLabel(key){
  const t=T[key];
  if(!t)return '0-0';
  return fmtRecord(teamRecord(key));
}
// ---- the median on a matchup page ----
// Both results, for both teams, on every weekly matchup: the head-to-head one
// the card already shows, and the one against the league. Hidden entirely when
// the setting is off, so a league that does not play the median never sees it.
function medChip(v){
  return v?`<i class="med-chip ${v.toLowerCase()}">${v}</i>`:`<i class="med-chip none">—</i>`;
}
function medRow(key,week){
  const r=weekResult(key,week);
  if(!r)return '';
  const t=T[key];
  return `<div class="med-row">
    <span class="med-tn tf-${key}" style="color:${t.c}">${escHtml(t.n)}</span>
    <span class="med-pts">${r.pts.toFixed(1)}</span>
    <span class="med-res">${medChip(r.h2h)}<small>H2H</small></span>
    <span class="med-res">${medChip(r.med)}<small>MED</small></span>
  </div>`;
}
export function medianStripHTML(aKey,xKey,week){
  if(!medianOn())return '';
  const med=leagueMedian(week),played=weekPlayed(week);
  return `<div class="med-strip">
    <div class="med-hd"><span>League Median · Week ${week}</span>
      <b>${played?med.toFixed(1):'—'}</b></div>
    ${medRow(aKey,week)}${medRow(xKey,week)}
    <div class="med-note">${played
      ? 'Every team also plays the league median this week — above it is a second win, below it a second loss.'
      : 'The median is set once the week is scored. Both results then count toward the standings.'}</div>
  </div>`;
}

/** Running record after each week, for the schedule page. */
export function runningRecords(key){
  const rec={w:0,l:0,t:0},out=[];
  const add=v=>{if(v==='W')rec.w++;else if(v==='L')rec.l++;else if(v==='T')rec.t++;};
  teamSchedule(key).forEach(r=>{
    add(r.h2h);
    if(medianOn())add(r.med);
    out.push({...r,record:(r.h2h||r.med)?fmtRecord(rec):null});
  });
  return out;
}
