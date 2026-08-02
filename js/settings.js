import { S } from './state.js';
import { slotAllows } from './clock.js';
import { LEAGUE_DEFAULTS, LG, SC, SCORING_DEFAULTS } from './data/league-config.js';
import { invalidateRosters, openConfirm, persistRoster, refreshRosterViews } from './freeagency.js';
import { MAXW, MINW } from './lineup.js';
import { preDraft, showView, toast, toggleDrawer } from './nav.js';
import { BENCH, IR, LINEUP, SLOTS, SLOT_ORDER, TAXI, buildSlots, saveStore, store } from './store.js';
import { ICON_STAR, ICON_UP, ICON_X } from './team.js';
import { escHtml } from './panel.js';
import { MY_TEAM, T } from './data/teams.js';
import { NOTIF_TYPES, notifPrefs } from './notifs.js';

// ---- who may change what ----
// Everyone in the league can read every setting. Only the commissioner can
// change one, and only the commissioner sees the Commissioner tab.
//
// There are no accounts in this prototype - "you" are always MY_TEAM - so the
// member's read-only view would otherwise be unreachable. `previewAsMember`
// makes it reachable without handing the role away; it is a view toggle, not a
// permission, and it never leaves the commissioner's own device.
export let previewAsMember=false;
export function commishKey(){return LG().commish||MY_TEAM;}
export function commishTeam(){return T[commishKey()]||T[MY_TEAM];}
export function ownsCommish(){return commishKey()===MY_TEAM;}
export function isCommish(){return ownsCommish()&&!previewAsMember;}
export function togglePreviewAsMember(){
  if(!ownsCommish())return;
  previewAsMember=!previewAsMember;
  if(previewAsMember&&setTab==='commish')setTab='general';
  renderSettings();
}
/** Every setter funnels through this, so a stray onclick cannot write. */
function guard(){
  if(isCommish())return true;
  toast(previewAsMember
    ? 'Read-only preview — turn it off in the Commissioner tab'
    : `Only the commissioner (${commishTeam().mgr}) can change league settings`);
  return false;
}
/** Attribute for native form controls when the viewer may not edit. */
function ro(){return isCommish()?'':' disabled';}

// ---- league settings controls ----
export const WDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function hourLabel(h){return (h%12||12)+':00 '+(h<12?'AM':'PM');}
export function setLeague(key,val,num){
  if(!guard()){renderSettings();return;}
  LG()[key]=num?+val:val;
  saveStore();
  renderSettings();
}
export function setLeagueNum(key,val,min,max){
  let v=Math.round(+val);
  if(!isFinite(v))v=LEAGUE_DEFAULTS[key];
  setLeague(key,Math.max(min,Math.min(max,v)),1);
}
export function optList(opts,cur){
  return opts.map(o=>`<option value="${o[0]}"${String(o[0])===String(cur)?' selected':''}>${o[1]}</option>`).join('');
}
export function setSel(key,opts,cur,num){
  return `<select class="set-ctl"${ro()} onchange="setLeague('${key}',this.value,${num?1:0})">${optList(opts,cur)}</select>`;
}
export function setNum(key,cur,min,max){
  return `<input class="set-ctl" type="number" inputmode="numeric" min="${min}" max="${max}" value="${cur}"${ro()}
    onchange="setLeagueNum('${key}',this.value,${min},${max})">`;
}
export function setRow(label,ctl){return `<div class="set-row"><div class="set-lb">${label}</div><div class="set-ctls">${ctl}</div></div>`;}
export function rangeOpts(a,b,fmt){const o=[];for(let i=a;i<=b;i++)o.push([i,fmt?fmt(i):String(i)]);return o;}
export function leagueCards(){
  const L=LG();
  const teamOpts=[8,10,12,14,16].map(n=>[n,n+' teams']);
  const waiverRows=L.waiver==='faab'
    ? setRow('Waiver budget',setNum('faabBudget',L.faabBudget,1,1000))+
      setRow('Minimum bid',setNum('faabMin',L.faabMin,0,Math.max(1,L.faabBudget)))
    : '';
  const sizeNote=+L.teams!==10
    ? `<div class="set-note" style="margin-top:11px;color:var(--violet)">City Boys Dynasty is playing 10 teams this season — ${L.teams} takes effect at the next draft.</div>`
    : '';
  return `
    <div class="set-card">
      <div class="set-title">General</div>
      ${setRow('League type',setSel('type',[['redraft','Redraft'],['keeper','Keeper'],['dynasty','Dynasty']],L.type))}
      ${setRow('Teams',setSel('teams',teamOpts,L.teams,1))}
      ${setRow('Lineup type',setSel('lineup',[['classic','Classic'],['bestball','Best ball']],L.lineup))}
      ${sizeNote}
    </div>
    <div class="set-card">
      <div class="set-title">Waivers</div>
      ${setRow('Waiver order',setSel('waiver',[['rolling','Rolling waivers'],['reverse','Reverse standings'],['faab','FAAB']],L.waiver))}
      ${waiverRows}
      ${setRow('Waivers clear',
        setSel('waiverDay',WDAYS.map((d,i)=>[i,d]),L.waiverDay,1)+
        setSel('waiverHour',rangeOpts(0,23,hourLabel),L.waiverHour,1))}
      ${setRow('Time on waivers',setSel('waiverPeriod',[[0,'None'],[1,'1 day'],[2,'2 days'],[3,'3 days']],L.waiverPeriod,1))}
    </div>
    <div class="set-card">
      <div class="set-title">Trades</div>
      ${setRow('Trade deadline',setSel('tradeDeadline',[[0,'No deadline']].concat(rangeOpts(MINW,MAXW,w=>'Week '+w)),L.tradeDeadline,1))}
    </div>`;
}
// ---- roster shape ----
export const SLOT_LABEL={QB:'QB',RB:'RB',WR:'WR',TE:'TE',FLEX:'FLEX',SFLX:'SFLX'};
export const SLOT_ELIG_TXT={QB:'Quarterback',RB:'Running back',WR:'Wide receiver',TE:'Tight end',
  FLEX:'Any RB, WR or TE',SFLX:'Any offensive player'};
export const SLOT_MAX={QB:4,RB:6,WR:6,TE:4,FLEX:4,SFLX:2};
export function starterCount(){return buildSlots().length;}
// grow/shrink a reserve array without ever dropping a row that still holds a player
export function resizeRows(arr,want){
  want=Math.max(0,Math.min(20,+want||0));
  while(arr.length<want)arr.push({a:null,x:null});
  for(let i=arr.length-1;i>=0&&arr.length>want;i--){if(!arr[i].a&&!arr[i].x)arr.splice(i,1);}
}
// re-seat one side into the new lineup: best projection first, overflow to the bench
export function reseat(list,side){
  list.sort((a,b)=>(b.proj||0)-(a.proj||0));
  const left=[];
  list.forEach(p=>{
    const r=LINEUP.find(row=>!row[side]&&slotAllows(row.slot,p.pos));
    if(r)r[side]=p;else left.push(p);
  });
  left.forEach(p=>{
    let row=BENCH.find(r=>!r[side]);
    if(!row){row={a:null,x:null};BENCH.push(row);}
    row[side]=p;
  });
}
export function applyRosterShape(){
  const S=SLOTS();
  const oldA=[],oldX=[];
  LINEUP.forEach(r=>{if(r.a)oldA.push(r.a);if(r.x)oldX.push(r.x);});
  BENCH.forEach(r=>{if(r.a)oldA.push(r.a);if(r.x)oldX.push(r.x);});
  BENCH.forEach(r=>{r.a=null;r.x=null;});
  S.lineupSlots=buildSlots();
  LINEUP.length=0;
  S.lineupSlots.forEach(sl=>LINEUP.push({slot:sl,a:null,x:null}));
  resizeRows(BENCH,S.bench);resizeRows(IR,S.ir);resizeRows(TAXI,S.taxi);
  reseat(oldA,'a');reseat(oldX,'x');
  S.pidx=null;invalidateRosters();persistRoster();
  refreshRosterViews();
}
export function setSlot(key,val){
  if(!guard()){renderSettings();return;}
  SLOTS()[key]=Math.max(0,Math.min(20,Math.round(+val)||0));
  saveStore();applyRosterShape();renderSettings();
}
export function slotSel(key,cur,max){
  return `<select class="set-ctl"${ro()} onchange="setSlot('${key}',this.value)">${optList(rangeOpts(0,max),cur)}</select>`;
}
export function rosterCards(){
  const S=SLOTS();
  return `
    <div class="set-card">
      <div class="set-title">Starting Lineup <span class="c">${starterCount()} STARTERS</span></div>
      ${SLOT_ORDER.map(k=>setRow(
        `${SLOT_LABEL[k]}<span class="s">${SLOT_ELIG_TXT[k]}</span>`,
        slotSel(k,S[k],SLOT_MAX[k]))).join('')}
    </div>
    <div class="set-card">
      <div class="set-title">Reserve</div>
      ${setRow('Bench spots',slotSel('bench',S.bench,16))}
      ${setRow('IR spots',slotSel('ir',S.ir,6))}
      ${setRow('Taxi squad spots',slotSel('taxi',S.taxi,6))}
    </div>`;
}
// ---- scoring ----
export function setScoring(key,val){
  if(!guard()){renderSettings();return;}
  let v=parseFloat(val);
  if(!isFinite(v))v=SCORING_DEFAULTS[key];
  SC()[key]=Math.max(-100,Math.min(100,Math.round(v*100)/100));
  saveStore();renderSettings();
}
export function scoreNum(key){
  return `<input class="set-ctl" type="number" step="0.01" inputmode="decimal" value="${SC()[key]}"${ro()}
    onchange="setScoring('${key}',this.value)">`;
}
export function resetScoring(){
  if(!guard())return;
  store.scoring=Object.assign({},SCORING_DEFAULTS);saveStore();renderSettings();
}
export function scoringCard(title,rows){
  return `<div class="set-card"><div class="set-title">${title}</div>
    ${rows.map(r=>setRow(r[1],scoreNum(r[0]))).join('')}</div>`;
}
export function scoringCards(){
  return scoringCard('Passing',[['passYd','Yards per point'],['passTD','Touchdown'],['passInt','Interception'],
      ['pass2pt','2-point conversion'],['passComp','Completion']])
    +scoringCard('Rushing',[['rushYd','Yards per point'],['rushTD','Touchdown'],
      ['rushAtt','Attempt'],['rush2pt','2-point conversion']])
    +scoringCard('Receiving',[['rec','Reception'],['recYd','Yards per point'],['recTD','Touchdown'],
      ['rec2pt','2-point conversion']])
    +scoringCard('Miscellaneous',[['fumLost','Fumble lost'],['fumTD','Fumble recovery TD'],
      ['krTD','Kick return TD'],['prTD','Punt return TD']])
    +(isCommish()?`<div class="set-card"><div class="set-btns">
        <div class="set-btn" onclick="resetScoring()">${ICON_X} Restore default scoring</div></div></div>`:'');
}

// ---- commissioner ----
export function setCommish(key){
  if(!guard()){renderSettings();return;}
  if(!T[key]||key===commishKey()){renderSettings();return;}
  // Handing it to someone else is one-way: the moment it lands you are a
  // member, and members cannot set the commissioner. Say so before it happens.
  if(key!==MY_TEAM){
    openConfirm(`Make ${T[key].mgr} commissioner?`,
      `${T[key].mgr} takes over league settings for City Boys Dynasty. You will be able to see them but not change them, and only ${T[key].mgr} can hand the role back.`,
      ()=>applyCommish(key),'Hand it over');
    renderSettings();   // snap the dropdown back until it is confirmed
    return;
  }
  applyCommish(key);
}
function applyCommish(key){
  LG().commish=key;
  if(!ownsCommish())setTab='general';
  saveStore();renderSettings();
  toast(key===MY_TEAM?'You are the commissioner'
    :`${T[key].mgr} is now the commissioner of City Boys Dynasty`);
}
// Deliberately thin for now - the tab exists, is commissioner-only, and holds
// the two controls that have to live somewhere. The rest is still to be spec'd.
export function commishCards(){
  const opts=Object.keys(T).map(k=>[k,`${T[k].mgr} · ${T[k].n}`]);
  return `
    <div class="set-card">
      <div class="set-title">Role</div>
      <div class="set-note">The commissioner is the only member who can change league settings.
        Everyone else sees them, read-only.</div>
      ${setRow('Commissioner',
        `<select class="set-ctl" onchange="setCommish(this.value)">${optList(opts,commishKey())}</select>`)}
    </div>
    <div class="set-card">
      <div class="set-title">Preview</div>
      <div class="set-note">See Settings the way the other nine managers see them. This only changes
        what you are looking at — you keep the role, and nobody else is affected.</div>
      <div class="set-btns">
        <div class="set-btn" onclick="togglePreviewAsMember()">View as a league member</div>
      </div>
    </div>
    <div class="set-card">
      <div class="set-title">More to come</div>
      <div class="set-note">Commissioner-only tools land here.</div>
    </div>`;
}

export const BASE_SET_TABS=[['general','General'],['roster','Roster'],['scoring','Scoring'],['matchups','Matchups'],['notifs','Alerts']];
// Notification preferences are personal, not league policy: they never leave
// this device and the commissioner has no say in them, so they skip `guard()`.
export function notifCards(){
  const p=notifPrefs();
  return `<div class="set-card">
    <div class="set-title">Notifications</div>
    ${NOTIF_TYPES.map(([k,lb])=>`<div class="set-row">
      <div class="set-lb">${lb}</div>
      <div class="set-ctls">
        <div class="set-tg${p[k]?' on':''}" onclick="setNotifPref('${k}',${p[k]?0:1})"><i></i></div>
      </div>
    </div>`).join('')}
  </div>`;
}
export function setTabs(){
  return isCommish()?BASE_SET_TABS.concat([['commish','★ Commissioner']]):BASE_SET_TABS;
}
export let setTab='general';
export function setSetTab(k){
  if(!setTabs().some(t=>t[0]===k))k='general';   // e.g. Commissioner after handing the role over
  setTab=k;renderSettings();document.getElementById('scroll').scrollTop=0;
}
export function renderSettings(){
  const bl=document.getElementById('setBackLb');if(bl)bl.textContent=preDraft()?'Draft':'Matchup';
  const has=!!store.globalBackdrop;
  const perGame=Object.keys(store.backdrops||{}).length;
  const preview=has
    ? `<div class="set-preview" style="background-image:url('${store.globalBackdrop}')"></div>`
    : `<div class="set-preview none">Default stadium field</div>`;
  const backdropCards=`
    <div class="set-card">
      <div class="set-title">League Matchup Backgrounds</div>
      <div class="set-note">Set one background for every matchup at once. This replaces any per-game backgrounds.</div>
      ${preview}
      ${isCommish()?`<div class="set-btns">
        <div class="set-btn primary" onclick="pickGlobalBackdrop()">${ICON_UP} ${has?'Change':'Set'} background for all matchups</div>
        <div class="set-btn" onclick="clearAllBackdrops()">${ICON_X} Clear all backgrounds</div>
      </div>`:''}
      ${perGame?`<div class="set-note" style="margin-top:11px;color:var(--violet)">${perGame} game${perGame>1?'s have':' has'} a custom background. Setting one for all clears those.</div>`:''}
    </div>
    <div class="set-card">
      <div class="set-title">Per-game backgrounds</div>
      <div class="set-note">${perGame} set.</div>
    </div>`;
  const bodies={general:leagueCards(),roster:rosterCards(),scoring:scoringCards(),
    matchups:backdropCards,notifs:notifCards(),commish:commishCards()};
  const cm=commishTeam();
  const sub=isCommish()
    ? `${ICON_STAR} Commissioner · City Boys Dynasty`
    : `City Boys Dynasty · Commissioner ${escHtml(cm.mgr)}`;
  // Members get the whole of Settings, read-only. Say so once, at the top,
  // rather than leaving them to work it out from greyed-out controls.
  const banner=(isCommish()||setTab==='notifs')?'':`
    <div class="set-ro">
      <div class="set-ro-t">${previewAsMember?'Previewing as a league member':'View only'}</div>
      <div class="set-ro-s">${previewAsMember
        ? 'This is what the other nine managers see. You still hold the role.'
        : `Only ${escHtml(cm.mgr)} can change these.`}</div>
      ${ownsCommish()?`<div class="set-ro-btn" onclick="togglePreviewAsMember()">Back to commissioner view</div>`:''}
    </div>`;
  document.getElementById('settingsBody').innerHTML=`
    <div class="set-h">Settings</div>
    <div class="set-sub">${sub}</div>
    <div class="set-tabs">${setTabs().map(t=>
      `<div class="set-tab${t[0]===setTab?' on':''}${t[0]==='commish'?' star':''}"
        onclick="setSetTab('${t[0]}')">${t[1]}</div>`).join('')}</div>
    ${banner}
    ${bodies[setTab]||bodies.general}`;
  // five tabs overflow a phone; keep the selected one on screen
  const on=document.querySelector('.set-tab.on');
  if(on&&on.scrollIntoView)on.scrollIntoView({inline:'nearest',block:'nearest'});
}
export function openSettings(){
  renderSettings();
  showView('settings');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scroll').scrollTop=0;
  if(document.body.classList.contains('open'))toggleDrawer();
}
