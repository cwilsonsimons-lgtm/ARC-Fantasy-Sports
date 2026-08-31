import { S } from './state.js';
import { MY_TEAM, T } from './data/teams.js';

// --- persistent team/player customizations (guarded so it never breaks if storage is unavailable) ---
export const STORE_KEY='cbd_team_v1';

// Uploaded pictures are kept in their own key, under their own budget.
//
// They used to live inside the state blob, so one localStorage entry held both
// a 135 KB backdrop and the fact that you had opened a trade — and the whole
// entry was rewritten on every change. Filling the roughly 5 MB an origin gets
// therefore stopped *everything* from saving, each failure reporting a storage
// error about photos even when photos had nothing to do with it. Thirty-eight
// backdrops did it. Splitting them fixes the coupling; the budget fixes the
// cause, by leaving the state room to save however many pictures are uploaded.
export const IMG_KEY='cbd_images_v1';
export const IMG_BUDGET=3*1024*1024;
let IMAGES={};

const isDataUrl=v=>typeof v==='string'&&v.slice(0,5)==='data:';

// store.players is keyed by player id in older saves and by league id in newer
// ones. Both shapes are read here, using the same test migratePlayerLeagues()
// applies, so a picture is found wherever it happens to sit.
function playersAreNested(bag){
  const keys=Object.keys(bag||{});
  return keys.length>0&&keys.every(k=>bag[k]&&typeof bag[k]==='object'&&!('photo'in bag[k])&&!('nick'in bag[k]));
}

// Everywhere in the state a picture can sit, as records naming the object that
// holds it. Saving lifts these out and puts them straight back, so the rest of
// the app goes on reading store.globalBackdrop and rec.photo exactly as before.
export function imageSlots(s){
  const out=[];
  const add=(id,owner,key)=>{if(owner&&isDataUrl(owner[key]))out.push({id,owner,key});};
  add('bg:global',s,'globalBackdrop');
  Object.keys(s.backdrops||{}).forEach(k=>add('bg:'+k,s.backdrops,k));
  Object.keys(s.leagueLogos||{}).forEach(k=>add('lg:'+k,s.leagueLogos,k));
  add('tm:logo',s.team,'logo');
  const players=s.players||{};
  if(playersAreNested(players))
    Object.keys(players).forEach(lid=>Object.keys(players[lid]||{}).forEach(pid=>add('pl:'+lid+':'+pid,players[lid][pid],'photo')));
  else
    Object.keys(players).forEach(pid=>add('pl::'+pid,players[pid],'photo'));
  return out;
}

// The inverse: put one saved picture back where it belongs, building the
// containers it needs. A player record also carries a nickname, so the photo
// merges into whatever is there rather than replacing the record.
export function placeImage(s,id,url){
  const kind=id.slice(0,3),rest=id.slice(3);
  if(id==='bg:global')s.globalBackdrop=url;
  else if(id==='tm:logo')(s.team=s.team||{}).logo=url;
  else if(kind==='bg:')(s.backdrops=s.backdrops||{})[rest]=url;
  else if(kind==='lg:')(s.leagueLogos=s.leagueLogos||{})[rest]=url;
  else if(kind==='pl:'){
    const cut=rest.indexOf(':');
    if(cut<0)return;
    const lid=rest.slice(0,cut),pid=rest.slice(cut+1);
    const players=s.players=s.players||{};
    const bag=lid?(players[lid]=players[lid]||{}):players;   // '' means the flat shape
    bag[pid]=Object.assign({},bag[pid],{photo:url});
  }
}

export function loadStore(){
  let s;
  try{s=JSON.parse(localStorage.getItem(STORE_KEY))||{};}catch(e){s={};}
  try{IMAGES=JSON.parse(localStorage.getItem(IMG_KEY))||{};}catch(e){IMAGES={};}
  Object.keys(IMAGES).forEach(id=>placeImage(s,id,IMAGES[id].u));
  // Pictures saved before the split are still inside the state blob. Leaving
  // them there is the whole migration: the first save lifts them out.
  return s;
}

// Write the pictures, dropping the least recently touched until they fit the
// budget. One more upload can then never cost the app its ability to save
// anything else — the worst it can do is push out the oldest picture.
function syncImages(held){
  const next={},now=Date.now();
  let changed=held.length!==Object.keys(IMAGES).length;
  held.forEach(slot=>{
    const was=IMAGES[slot.id];
    next[slot.id]={u:slot.value,t:was&&was.u===slot.value?was.t:now};
    if(!was||was.u!==slot.value)changed=true;
  });
  const dropped={};
  const oldestFirst=Object.keys(next).sort((a,b)=>next[a].t-next[b].t);
  let total=oldestFirst.reduce((n,id)=>n+next[id].u.length,0);
  while(total>IMG_BUDGET&&oldestFirst.length){
    const id=oldestFirst.shift();
    total-=next[id].u.length;
    delete next[id];
    dropped[id]=true;
    changed=true;
  }
  if(!changed)return {ok:true,dropped,evicted:false};
  IMAGES=next;
  try{
    localStorage.setItem(IMG_KEY,JSON.stringify(next));
    return {ok:true,dropped,evicted:Object.keys(dropped).length>0};
  }catch(e){return {ok:false,dropped,evicted:false};}
}

export function saveStore(){
  const held=imageSlots(store);
  held.forEach(slot=>{slot.value=slot.owner[slot.key];delete slot.owner[slot.key];});
  let ok=true;
  try{localStorage.setItem(STORE_KEY,JSON.stringify(store));}catch(e){ok=false;}
  const img=syncImages(held);
  // An evicted picture is gone. Putting it back in memory would only hide that
  // until the next reload, which is a worse way to find out.
  held.forEach(slot=>{if(!img.dropped[slot.id])slot.owner[slot.key]=slot.value;});
  if(!ok)showSaveWarning('state');
  else if(!img.ok)showSaveWarning('image');
  else if(img.evicted)showSaveWarning('evicted');
  return ok;
}

// How much of the picture budget is spent.
export function imageUsage(){
  const ids=Object.keys(IMAGES);
  const used=ids.reduce((n,id)=>n+IMAGES[id].u.length,0);
  return {count:ids.length,used,budget:IMG_BUDGET,pct:Math.min(100,Math.round(used/IMG_BUDGET*100))};
}

// The old message blamed photos for every failure, including the ones photos
// had nothing to do with, and told you to delete things that were not the
// problem. Each case now says what actually happened.
export const SAVE_WARNINGS={
  state:'Recent changes could not be saved — this browser is out of storage, or is blocking it in a private window.',
  image:'That picture could not be saved — this browser is out of storage. Everything else was saved.',
  evicted:'Storage for pictures is full, so the oldest upload was removed to make room for this one.'
};
export function showSaveWarning(kind){
  const existing=document.getElementById('saveWarn');
  if(existing&&existing.dataset.kind===kind)return;
  if(existing)existing.remove();
  const b=document.createElement('div');
  b.id='saveWarn';
  b.dataset.kind=kind;
  b.innerHTML='<span>'+(SAVE_WARNINGS[kind]||SAVE_WARNINGS.state)+'</span><button aria-label="Dismiss" onclick="this.parentNode.remove()">&#10005;</button>';
  (document.querySelector('.phone')||document.body).appendChild(b);
}

// Re-encode until the picture fits `cap`. A backdrop off a modern camera landed
// at 135 KB with the sizes this used to ask for, which is most of a megabyte
// for a handful of them. Quality gives way first and dimensions second; the
// mime type is never changed, because a logo would lose its transparency and
// show as a black box on the crest behind it.
// mime='image/png' preserves transparency (logos); 'image/jpeg' is smaller (photos/backdrops).
function encodeUnder(img,maxDim,mime,quality,cap){
  let w=img.width,h=img.height;
  if(w>maxDim||h>maxDim){const s=maxDim/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
  const draw=(dw,dh,q)=>{
    const c=document.createElement('canvas');
    c.width=Math.max(1,dw);c.height=Math.max(1,dh);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL(mime,q);
  };
  let q=quality,url=draw(w,h,q);
  // PNG ignores the quality argument, so for a logo this loop does nothing and
  // the size comes off the dimensions below instead.
  while(url.length>cap&&q>0.45){q=Math.max(0.45,q-0.12);url=draw(w,h,q);}
  while(url.length>cap&&Math.max(w,h)>240){w=Math.round(w*0.8);h=Math.round(h*0.8);url=draw(w,h,q);}
  return url;
}
export function processImage(file,maxDim,mime,quality,cb,cap){
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      try{cb(encodeUnder(img,maxDim,mime,quality,cap||96*1024));}
      catch(e){cb(r.result);}   // canvas blocked (rare) → fall back to original
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



export function SLOTS(){return store.slots;}
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
store.draft=store.draft||{picks:[]};
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
