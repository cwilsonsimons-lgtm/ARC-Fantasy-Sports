import { S } from '../state.js';
import { NFL_SCHED_SRC } from './nfl-schedule.js';
import { NFL_TEAMS } from './nfl-teams.js';
import { pIdx } from '../player.js';
import { BENCH, IR, LINEUP, TAXI, saveStore, store } from '../store.js';

// kickoff times are listed in ET; this league reads Central
export function kickCT(t){const p=t.split(':');return ((+p[0]+23)%24%12||12)+':'+p[1];}
export function kickOrd(dt,t){const d=dt.split('-'),k=t.split(':');
  return Math.round(Date.UTC(+d[0],+d[1]-1,+d[2])/86400000)*2000+(+k[0])*60+(+k[1]);}

export const NFL_WEEKS={},NFL_TEAM_WEEK={},ORD_LABEL={};
Object.keys(NFL_SCHED_SRC).forEach(w=>{
  NFL_WEEKS[w]=NFL_SCHED_SRC[w].split(',').map(s=>{const f=s.split('>');
    return {a:f[0],h:f[1],d:f[2],t:f[3],dt:f[4]};});
  NFL_WEEKS[w].forEach(g=>{
    const ord=kickOrd(g.dt,g.t);
    ORD_LABEL[ord]=g.d.toUpperCase()+' '+kickCT(g.t);
    (NFL_TEAM_WEEK[g.a]=NFL_TEAM_WEEK[g.a]||{})[w]={opp:g.h,home:false,d:g.d,t:g.t,ord:ord};
    (NFL_TEAM_WEEK[g.h]=NFL_TEAM_WEEK[g.h]||{})[w]={opp:g.a,home:true,d:g.d,t:g.t,ord:ord};
  });
});
export function byeFor(tm){const t=NFL_TEAMS[tm];return t?t.bye:null;}
export function weekGame(tm,wk){const r=NFL_TEAM_WEEK[tm];return r?(r[wk]||null):null;}
export function gameLabel(tm,wk){
  if(!tm||tm==='FA')return '';
  const g=weekGame(tm,wk);
  if(!g)return byeFor(tm)===+wk?'BYE':'';
  return g.d+' '+kickCT(g.t)+' '+(g.home?'vs ':'@ ')+g.opp;
}
// stamp this week's opponent, kickoff ordinal and bye onto a roster player
export function hydratePlayer(p,wk){
  if(!p)return p;
  if(p.fa||p.tm==='FA'||!NFL_TEAMS[p.tm]){p.g=p.g||'';p.bye=null;p.ord=Infinity;return p;}
  const g=weekGame(p.tm,wk);
  p.bye=byeFor(p.tm); p.g=gameLabel(p.tm,wk); p.ord=g?g.ord:Infinity;
  return p;
}
export function hydrateRosters(wk){
  [LINEUP,BENCH,IR,TAXI].forEach(a=>a.forEach(r=>{hydratePlayer(r.a,wk);hydratePlayer(r.x,wk);}));
  S.pidx=null;
}
// single seam for per-player storage keys (photo/nickname). Swap to ids here later.
export function pkey(key){const r=pIdx()[key];return (r&&r.id)||key;}
// one-time: move photos/nicknames saved under a display name onto that player's id
export function migratePlayerStore(){
  if(store.pkeyv===2)return;
  const out={};
  Object.keys(store.players||{}).forEach(k=>{
    const r=pIdx()[k];
    out[(r&&r.id)||k]=Object.assign({},out[(r&&r.id)||k],store.players[k]);
  });
  store.players=out;store.pkeyv=2;saveStore();
}
/** v2 kept one bag for every league. v3 gives each league its own, and the
 *  existing one is City Boys Dynasty's because that is the only league that
 *  could have written to it. */
export function migratePlayerLeagues(){
  if(store.pkeyv3)return;
  const flat=store.players||{};
  const looksNested=Object.keys(flat).every(k=>flat[k]&&typeof flat[k]==='object'
    &&!('photo' in flat[k])&&!('nick' in flat[k]));
  store.players=(Object.keys(flat).length&&!looksNested)?{cbd:flat}:(looksNested?flat:{});
  store.pkeyv3=1;saveStore();
}
