import { S } from './state.js';
import { MY_TEAM, T } from './data/teams.js';

// --- persistent team/player customizations (guarded so it never breaks if storage is unavailable) ---
export const STORE_KEY='cbd_team_v1';
export function loadStore(){try{return JSON.parse(localStorage.getItem(STORE_KEY))||{}}catch(e){return {}}}
export function saveStore(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(store));return true;}
  catch(e){showSaveWarning();return false;}
}
// warn once when a write fails (quota full, or private/incognito blocks storage)
export function showSaveWarning(){
  if(document.getElementById('saveWarn'))return;
  const b=document.createElement('div');
  b.id='saveWarn';
  b.innerHTML='<span>Storage is full or unavailable — recent changes may not be saved. Try removing some uploaded photos or backgrounds.</span><button aria-label="Dismiss" onclick="this.parentNode.remove()">&#10005;</button>';
  (document.querySelector('.phone')||document.body).appendChild(b);
}
// Downscale an uploaded image through a canvas so we store small thumbnails instead of multi-MB originals.
// mime='image/png' preserves transparency (logos); 'image/jpeg' is smaller (photos/backdrops).
export function processImage(file,maxDim,mime,quality,cb){
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width,h=img.height;
      if(w>maxDim||h>maxDim){const s=maxDim/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
      try{
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        cb(c.toDataURL(mime,quality));
      }catch(e){cb(r.result);}   // canvas blocked (rare) → fall back to original
    };
    img.onerror=()=>cb(r.result);
    img.src=r.result;
  };
  r.onerror=()=>{};
  r.readAsDataURL(file);
}
export let store=loadStore(); store.team=store.team||{}; store.players=store.players||{};






// crest inner content: uploaded logo image if set, else the team's mono letter
export function markInner(t){return t.logo?`<img src="${t.logo}" alt="" style="width:100%;height:100%;object-fit:cover">`:t.mono;}
// Week 1 is scheduled, not played — every game sits at 0.0
export const GAMES = [
  {a:'pandas',as:0,aw:50,x:'radiator',xs:0,xw:50,live:false,me:true},
  {a:'barzal',as:0,aw:50,x:'dakyard',xs:0,xw:50,live:false},
  {a:'boutte',as:0,aw:50,x:'burrow',xs:0,xw:50,live:false},
  {a:'saquon',as:0,aw:50,x:'brady',xs:0,xw:50,live:false},
  {a:'longhorns',as:0,aw:50,x:'doghouse',xs:0,xw:50,live:false},
];
// Starting lineup shape — commissioner-set counts per slot (Settings ▸ Roster).
// No K/DEF while the player pool is QB/RB/WR/TE only.
export const SLOT_ORDER=['QB','RB','WR','TE','FLEX','SFLX'];
export const SLOT_DEFAULTS={QB:1,RB:2,WR:3,TE:1,FLEX:1,SFLX:0,bench:7,ir:2,taxi:2};



// Serve the current created league's roster shape when one is open (see the
// MULTI-LEAGUE note in data/league-config.js). Looked up by id here rather than
// imported, to keep store.js free of module cycles.
export function SLOTS(){
  const id=store.curLeagueId,l=id&&(store.leagues||[]).find(x=>x.id===id);
  return (l&&l.slots)||store.slots;
}
export function buildSlots(){
  const S=SLOTS(),out=[];
  SLOT_ORDER.forEach(k=>{for(let i=0;i<Math.max(0,+S[k]||0);i++)out.push(k);});
  return out;
}

// Empty until the draft runs. a = my team, x = Week 1 opponent.
export const LINEUP = [];
export const BENCH  = [];
export const IR     = [];
export const TAXI   = [];

// Ran at top level in the original single-file script. main.js calls it
// during boot so it keeps its original position in the startup order.
export function initStore(){
// Gameplay data (rosters, matchups, the draft) belongs to City Boys Dynasty,
// so every boot lands there; created leagues are reopened from the selector.
store.curLeagueId=null;
store.draft=store.draft||{picks:[]};
store.leagues=store.leagues||[];
store.leagues.forEach(l=>{l.slots=Object.assign({},SLOT_DEFAULTS,l.slots||{});});
if(store.team&&store.team.font)T[MY_TEAM].font=store.team.font;
store.backdrops=store.backdrops||{};  // per-game: {gameKey: dataURL}
if(store.backdrop){store.globalBackdrop=store.globalBackdrop||store.backdrop;delete store.backdrop;}  // migrate old single backdrop
// apply saved edits to my team so the whole app reflects them
(function(){const o=store.team,t=T[MY_TEAM];if(o.name)t.n=o.name;if(o.c)t.c=o.c;if(o.bg)t.bg=o.bg;if(o.logo)t.logo=o.logo;})();
store.slots=Object.assign({},SLOT_DEFAULTS,store.slots||{});
// IR spots used to live under General — carry the old value over
if(store.league&&store.league.irSpots!=null){store.slots.ir=+store.league.irSpots;delete store.league.irSpots;}
  S.lineupSlots=buildSlots();
  const fill=(rows,n)=>{rows.length=0;for(let i=0;i<Math.max(0,n);i++)rows.push({a:null,x:null});};
  LINEUP.length=0;
  S.lineupSlots.forEach(sl=>LINEUP.push({slot:sl,a:null,x:null}));
  fill(BENCH,+SLOTS().bench||0);
  fill(IR,+SLOTS().ir||0);
  fill(TAXI,+SLOTS().taxi||0);
}
