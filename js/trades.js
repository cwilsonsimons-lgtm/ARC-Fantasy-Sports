import { S } from './state.js';
import { MY_TEAM, T } from './data/teams.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { hydratePlayer } from './data/nfl-index.js';
import { draftDone, fillSide, mkPlayer } from './draft.js';
import { invalidateRosters, persistRoster, refreshRosterViews } from './freeagency.js';
import { toast } from './nav.js';
import { selectRail } from './panel.js';
import { faceInner, pKeyOf } from './player.js';
import { BENCH, LINEUP, TAXI, markInner, saveStore, store } from './store.js';
import { esc, rosterFor } from './team.js';

// ======================= TRADE CENTER =======================
// Lives inside the drawer panel (like Trending / Available), so the main screen
// stays pushed aside. Every trade has one real side — yours (MY_TEAM) — and one
// counterpart; a deal always stores `send` (players leaving your roster) and
// `get` (players joining it), whichever manager started it. Accepting one moves
// players through store.tradeOwners, the single ownership seam teamRosterIds()
// honours, so a player is never on two rosters at once.

// ---- panel state ----
let mode = 'overview';                  // overview | chooser | builder
export let tradePartner = null;         // the other team's key (builder)
export let sendSel = new Set();         // pKeyOf() of my players going out
export let getSel = new Set();          // pKeyOf() of their players coming in
let ticker = null;

// ---- value: a player is worth their season projection (same yardstick Markets prices on) ----
export function assetValue(p){
  const rec = p && p.id && NFL_BY_ID[p.id];
  if (rec && rec.sproj != null) return rec.sproj;
  return Math.round((p && p.proj || 0) * 17);
}
export function tradeTeams(){ return Object.keys(T).filter(k => k !== MY_TEAM); }
function mgrOf(key){ return (T[key] && T[key].mgr) || key; }
function teamRoster(key){ return (rosterFor(key) || []).filter(p => p.id); }

// each manager has a stable appetite for a deal: they accept when the value they
// receive is at least this fraction of what they give up.
function toughness(key){
  let h = 2166136261;
  for (let i = 0; i < key.length; i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.88 + ((h >>> 0) % 90) / 1000;   // 0.88 – 0.97
}

// ---- selection helpers (builder) ----
function selList(roster, sel){ return roster.filter(p => sel.has(pKeyOf(p))); }
function sum(list){ return list.reduce((t, p) => t + assetValue(p), 0); }
export function tradeToggle(side, key){
  const sel = side === 'send' ? sendSel : getSel;
  if (sel.has(key)) sel.delete(key); else sel.add(key);
  renderTradesPanel();
}
export function tradeOverview(){ mode = 'overview'; tradePartner = null; sendSel = new Set(); getSel = new Set(); renderTradesPanel(); }
export function pickTradePartner(key){ tradePartner = key; mode = 'builder'; sendSel = new Set(); getSel = new Set(); renderTradesPanel(); scrollTop(); }
function scrollTop(){ const p = document.getElementById('panel'); if (p) p.scrollTop = 0; }

// ---- crest / face chips ----
function crest(key, size){
  const t = T[key];
  return `<span class="trd-crest" style="width:${size}px;height:${size}px;background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${markInner(t)}</span>`;
}
function faceChip(p, ring){
  return `<div class="trd-chip">
    <span class="trd-cface" style="${ring ? `box-shadow:0 0 0 2px ${ring}` : ''}">${faceInner(p.id || p.n)}</span>
    <div class="trd-cnm">${p.n}</div>
  </div>`;
}

// ---------- TRADE BLOCK ----------
function blockList(){
  const on = new Set(store.tradeBlock || []);
  return teamRoster(MY_TEAM).filter(p => on.has(p.id));
}
export function toggleBlock(id){
  store.tradeBlock = store.tradeBlock || [];
  const i = store.tradeBlock.indexOf(id);
  if (i > -1) store.tradeBlock.splice(i, 1); else store.tradeBlock.push(id);
  saveStore(); renderBlockSheet(); renderTradesPanel();
}
function blockStrip(){
  const list = blockList(), c = T[MY_TEAM].c;
  const chips = list.map(p =>
    `<div class="tb-av" onclick="openPlayer('${esc(p.id)}')">
      <span class="tb-av-face" style="box-shadow:0 0 0 2.5px ${c}">${faceInner(p.id)}</span>
      <div class="tb-av-nm">${p.n}</div>
      <div class="tb-av-mt">${p.pos} · ${p.tm}</div>
    </div>`).join('');
  const add = `<div class="tb-av tb-add" onclick="openBlockSheet()">
      <span class="tb-av-face tb-plus">+</span><div class="tb-av-nm">Add</div><div class="tb-av-mt">&nbsp;</div></div>`;
  return `<div class="trd-sec-hd"><span>Trade Block</span></div>
    <div class="tb-strip">${chips}${add}</div>`;
}

// ---- trade block sheet ----
export function openBlockSheet(){ renderBlockSheet(); document.getElementById('tbScrim').classList.add('show'); document.getElementById('tbSheet').classList.add('show'); }
export function closeBlockSheet(){ document.getElementById('tbScrim').classList.remove('show'); document.getElementById('tbSheet').classList.remove('show'); }
function renderBlockSheet(){
  const on = new Set(store.tradeBlock || []);
  const rows = teamRoster(MY_TEAM).map(p => {
    const yes = on.has(p.id);
    return `<div class="tb-row${yes ? ' on' : ''}" onclick="toggleBlock('${esc(p.id)}')">
      <span class="tb-face">${faceInner(p.id)}</span>
      <div class="tb-info"><div class="tb-nm">${p.n}</div><div class="tb-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}</div></div>
      <span class="tb-tog">${yes ? 'On block' : 'Add'}</span>
    </div>`;
  }).join('');
  document.getElementById('tbBody').innerHTML =
    `<div class="tb-note">Flag players you're open to moving — they show up on your block for the league to see.</div>${rows || '<div class="tb-note">Your roster is empty.</div>'}`;
}

// ---------- ACTIVE TRADES + HISTORY ----------
function fmtCountdown(ms){
  if (ms <= 0) return 'Expired';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const p = n => String(n).padStart(2, '0');
  return (d ? `${d}D ` : '') + `${p(h)}H ${p(m)}M ${p(s)}S`;
}
function dirBadge(dir){
  return dir === 'incoming'
    ? `<span class="trd-dir in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M6 13l6 6 6-6"/></svg></span>INCOMING`
    : `<span class="trd-dir out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M6 11l6-6 6 6"/></svg></span>OUTGOING`;
}
function statusRight(d){
  if (d.status === 'accepted') return `<span class="trd-st ok">Complete</span>`;
  if (d.status === 'rejected') return `<span class="trd-st no">Rejected</span>`;
  if (d.status === 'expired')  return `<span class="trd-st ex">Expired</span>`;
  if (d.dir === 'outgoing')    return `<span class="trd-st wait">Reviewing…</span>`;
  return `<span class="trd-cd" data-exp="${d.expiry}">${fmtCountdown(d.expiry - Date.now())}</span>`;
}
function swapRow(d){
  const c = T[MY_TEAM].c, oc = T[d.partner] ? T[d.partner].c : '#5AA9E6';
  const out = d.send.map(p => faceChip(p, c)).join('') || '<div class="trd-cnone">—</div>';
  const inn = d.get.map(p => faceChip(p, oc)).join('')  || '<div class="trd-cnone">—</div>';
  return `<div class="trd-swap"><div class="trd-side">${out}</div>
    <span class="trd-swap-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg></span>
    <div class="trd-side">${inn}</div></div>`;
}
function dealCard(d, live){
  let actions = '';
  if (live && d.status === 'pending'){
    actions = d.dir === 'incoming'
      ? `<div class="trd-btns"><div class="trd-mini danger" onclick="rejectIncoming('${d.id}')">Reject</div><div class="trd-mini go" onclick="acceptIncoming('${d.id}')">Accept</div></div>`
      : `<div class="trd-btns"><div class="trd-mini danger" onclick="cancelTrade('${d.id}')">Cancel offer</div></div>`;
  }
  return `<div class="trd-deal">
    <div class="trd-deal-top"><div class="trd-deal-dir ${d.dir}">${dirBadge(d.dir)}</div>${statusRight(d)}</div>
    <div class="trd-deal-mgr">${crest(d.partner, 30)}<div><div class="trd-deal-nm">${mgrOf(d.partner)}</div><div class="trd-deal-sub">2-way trade</div></div></div>
    ${swapRow(d)}
    ${d.note ? `<div class="trd-deal-note">${d.note}</div>` : ''}
    ${actions}
  </div>`;
}
function emptyActive(){
  return `<div class="trd-empty">
    <svg class="trd-empty-ill" viewBox="0 0 150 116" fill="none">
      <rect x="34" y="14" width="42" height="58" rx="9" fill="#182034" stroke="#28344c" stroke-width="1.5"/>
      <rect x="76" y="42" width="42" height="58" rx="9" fill="#182034" stroke="#28344c" stroke-width="1.5"/>
      <circle cx="55" cy="34" r="7" fill="#2c3a54"/><path d="M45 52a10 10 0 0 1 20 0" fill="#2c3a54"/>
      <circle cx="97" cy="62" r="7" fill="#2c3a54"/><path d="M87 80a10 10 0 0 1 20 0" fill="#2c3a54"/>
      <path d="M82 20c22-4 30 6 28 22" stroke="#4fd6a8" stroke-width="2.5" stroke-linecap="round"/><path d="m108 44 4-8-8 1" fill="#4fd6a8"/>
      <path d="M70 94c-22 4-30-6-28-22" stroke="#4fd6a8" stroke-width="2.5" stroke-linecap="round"/><path d="m44 70-4 8 8-1" fill="#4fd6a8"/>
    </svg>
    <div class="trd-empty-t">No active trades — pick a team below to start one.</div>
  </div>`;
}
// the league team list — the primary way to start a trade
function proposeList(){
  const rows = tradeTeams().map(k => {
    const t = T[k];
    return `<div class="trd-team" onclick="pickTradePartner('${k}')">
      ${crest(k, 38)}
      <div class="trd-team-i"><div class="trd-team-n tf-${k}" style="color:${t.c}">${t.n}</div><div class="trd-team-m">${t.mgr} · ${t.rec}</div></div>
      <span class="trd-team-go">›</span></div>`;
  }).join('');
  return `<div class="trd-sec-hd"><span>Propose a Trade</span></div>
    <div class="trd-lead">Pick a team, then check the players on each side.</div>
    <div class="trd-teams">${rows}</div>`;
}

// ---------- OVERVIEW ----------
function overviewHTML(){
  const active = store.tradesPending;
  const hist = store.trades;
  return blockStrip()
    + `<div class="trd-sec-hd"><span>Active Trades</span></div>`
    + (active.length ? active.map(d => dealCard(d, true)).join('') : emptyActive())
    + proposeList()
    + (hist.length ? `<div class="trd-sec-hd"><span>Trade History</span></div>` + hist.map(d => dealCard(d, false)).join('') : '');
}

// ---------- BUILDER (in panel, stacked) ----------
function colHTML(key, roster, side){
  const rows = roster.length ? roster.map(p => {
    const k = pKeyOf(p), on = (side === 'send' ? sendSel : getSel).has(k);
    return `<div class="trd-row${on ? ' on' : ''}" onclick="tradeToggle('${side}','${esc(k)}')">
      <span class="trd-chk">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-11"/></svg>' : ''}</span>
      <span class="trd-face">${faceInner(k)}</span>
      <div class="trd-info"><div class="trd-nm">${p.n}</div><div class="trd-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}${p.bye ? ` (${p.bye})` : ''}</div></div>
      <span class="trd-val">${assetValue(p).toFixed(0)}</span></div>`;
  }).join('') : `<div class="trd-empty-col">No players</div>`;
  return `<div class="trd-col-hd">${crest(key, 20)}<span>${side === 'send' ? 'You send' : 'You get'}</span></div><div class="trd-col-body">${rows}</div>`;
}
function verdict(give, get){
  if (!give && !get) return { c: 'idle', t: 'Pick players from both sides' };
  if (!give || !get)  return { c: 'idle', t: 'Add a player to each side' };
  const diff = get - give, big = Math.max(give, get);
  if (Math.abs(diff) <= big * 0.08) return { c: 'fair', t: 'Even trade' };
  return diff > 0 ? { c: 'win', t: 'You come out ahead' } : { c: 'lose', t: 'You give up more value' };
}
function builderHTML(){
  const mine = teamRoster(MY_TEAM), yours = teamRoster(tradePartner);
  const give = sum(selList(mine, sendSel)), get = sum(selList(yours, getSel));
  const v = verdict(give, get), ready = sendSel.size && getSel.size;
  return `<div class="trd-back" onclick="tradeOverview()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>All teams</div>
    <div class="trd-partner">${crest(tradePartner, 30)}<div class="trd-partner-i"><div class="trd-partner-n tf-${tradePartner}" style="color:${T[tradePartner].c}">${T[tradePartner].n}</div><div class="trd-partner-m">${T[tradePartner].mgr} · ${T[tradePartner].rec}</div></div></div>
    <div class="trd-col">${colHTML(MY_TEAM, mine, 'send')}</div>
    <div class="trd-col">${colHTML(tradePartner, yours, 'get')}</div>
    <div class="trd-foot">
      <div class="trd-sum"><div class="trd-sum-cols">
          <div class="trd-sum-c"><div class="k">You send</div><div class="v">${give.toFixed(0)}</div></div>
          <div class="trd-sum-swap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg></div>
          <div class="trd-sum-c"><div class="k">You get</div><div class="v">${get.toFixed(0)}</div></div>
        </div><div class="trd-verdict ${v.c}">${v.t}</div></div>
      <div class="trd-cta${ready ? '' : ' off'}" onclick="${ready ? 'proposeTrade()' : ''}">Propose Trade</div>
    </div>`;
}

// ---------- render ----------
export function renderTradesPanel(){
  const el = document.getElementById('panel'); if (!el) return;
  if (!draftDone()){
    el.innerHTML = `<div class="trd-blank"><div class="trd-blank-t">Trades open after the draft</div><div class="trd-blank-s">Once every pick is in, you can start shopping your roster.</div></div>`;
    return;
  }
  sweepExpired(); resolveStaleOutgoing();
  const body = mode === 'builder' && tradePartner ? builderHTML() : overviewHTML();
  el.innerHTML = body;
  startTicker();
}
function startTicker(){
  stopTicker();
  const has = document.querySelectorAll('#panel .trd-cd[data-exp]').length;
  if (!has) return;
  ticker = setInterval(() => {
    const list = document.querySelectorAll('#panel .trd-cd[data-exp]');
    if (!list.length) return stopTicker();
    list.forEach(e => { e.textContent = fmtCountdown(+e.dataset.exp - Date.now()); });
  }, 1000);
}
function stopTicker(){ if (ticker){ clearInterval(ticker); ticker = null; } }

// ---------- lightweight storage record ----------
function slim(p){ return { id: p.id || null, n: p.n, pos: p.pos, tm: p.tm, proj: p.proj != null ? p.proj : null, val: assetValue(p) }; }
function uid(){ return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function dealVal(list){ return (list || []).reduce((t, p) => t + (p.val || 0), 0); }

// ---------- propose (outgoing) ----------
export function proposeTrade(){
  const mine = teamRoster(MY_TEAM), yours = teamRoster(tradePartner);
  const send = selList(mine, sendSel), get = selList(yours, getSel);
  if (!send.length || !get.length){ toast('Add a player to each side'); return; }
  const deal = { id: uid(), dir: 'outgoing', partner: tradePartner, send: send.map(slim), get: get.map(slim),
    ts: Date.now(), expiry: Date.now() + 3 * 864e5, status: 'pending' };
  store.tradesPending.unshift(deal);
  saveStore();
  const mgr = mgrOf(tradePartner);
  mode = 'overview'; tradePartner = null; sendSel = new Set(); getSel = new Set();
  renderTradesPanel();
  toast(`Offer sent to ${mgr}`);
  setTimeout(() => resolveTrade(deal.id), 2600);   // the other manager "reviews" it
}
export function cancelTrade(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  store.tradesPending.splice(i, 1); saveStore(); renderTradesPanel(); toast('Offer withdrawn');
}

// ---------- the counterpart decides an outgoing offer ----------
export function resolveTrade(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  const d = store.tradesPending[i];
  const give = dealVal(d.send), get = dealVal(d.get);   // they receive `give`, give up `get`
  const ok = give >= get * toughness(d.partner);
  store.tradesPending.splice(i, 1);
  const mgr = mgrOf(d.partner);
  if (ok){
    d.status = 'accepted'; d.note = `${mgr} accepted your offer.`;
    executeTrade(d.partner, d.send, d.get);
    toast(`${mgr} accepted the trade`);
  } else {
    d.status = 'rejected';
    d.note = give >= get * (toughness(d.partner) - 0.06)
      ? `${mgr} passed — close, but wanted a bit more back.`
      : `${mgr} rejected it — too far in your favour.`;
    toast(`${mgr} rejected the trade`);
  }
  d.resolvedTs = Date.now();
  store.trades.unshift(d); saveStore();
  if (document.querySelector('#panel')) renderTradesPanel();
}
// a page reload loses the setTimeout above; clear anything left hanging on open
function resolveStaleOutgoing(){
  store.tradesPending.filter(d => d.dir === 'outgoing' && Date.now() - d.ts > 2600)
    .forEach(d => resolveTrade(d.id));
}

// ---------- incoming offers from other managers ----------
export function acceptIncoming(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  const d = store.tradesPending[i]; store.tradesPending.splice(i, 1);
  d.status = 'accepted'; d.note = `You accepted ${mgrOf(d.partner)}'s offer.`; d.resolvedTs = Date.now();
  executeTrade(d.partner, d.send, d.get);
  store.trades.unshift(d); saveStore(); renderTradesPanel();
  toast('Trade accepted');
}
export function rejectIncoming(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  const d = store.tradesPending[i]; store.tradesPending.splice(i, 1);
  d.status = 'rejected'; d.note = `You rejected ${mgrOf(d.partner)}'s offer.`; d.resolvedTs = Date.now();
  store.trades.unshift(d); saveStore(); renderTradesPanel();
  toast('Trade rejected');
}
function sweepExpired(){
  const now = Date.now(); let changed = false;
  store.tradesPending.slice().forEach(d => {
    if (d.dir === 'incoming' && d.expiry && d.expiry <= now){
      const i = store.tradesPending.indexOf(d); store.tradesPending.splice(i, 1);
      d.status = 'expired'; d.note = `${mgrOf(d.partner)}'s offer expired.`; d.resolvedTs = now;
      store.trades.unshift(d); changed = true;
    }
  });
  if (changed) saveStore();
}
// build a believable offer aimed at one of your players (favouring your block)
function generateIncoming(){
  const partners = tradeTeams().filter(k => teamRoster(k).length);
  if (!partners.length) return false;
  const partner = partners[Math.floor(Math.random() * partners.length)];
  const theirs = teamRoster(partner).sort((a, b) => assetValue(b) - assetValue(a));
  const mineAll = teamRoster(MY_TEAM);
  const blocked = new Set(store.tradeBlock || []);
  const wantPool = mineAll.filter(p => blocked.has(p.id));
  const target = (wantPool.length ? wantPool : mineAll.sort((a, b) => assetValue(b) - assetValue(a)).slice(0, 6))
    [Math.floor(Math.random() * (wantPool.length || Math.min(6, mineAll.length)))];
  if (!target) return false;
  const tv = assetValue(target);
  // offer a player of theirs within ±25% of the target's value
  const near = theirs.filter(p => Math.abs(assetValue(p) - tv) <= tv * 0.25);
  const offer = (near.length ? near : theirs)[Math.floor(Math.random() * (near.length || theirs.length))];
  if (!offer) return false;
  store.tradesPending.unshift({
    id: uid(), dir: 'incoming', partner,
    send: [slim(target)],   // what leaves your roster if you accept
    get: [slim(offer)],     // what you'd receive
    ts: Date.now(), expiry: Date.now() + (1 + Math.floor(Math.random() * 3)) * 864e5, status: 'pending'
  });
  return true;
}
function maybeIncoming(){
  const incoming = store.tradesPending.filter(d => d.dir === 'incoming').length;
  if (!store.tradesSeeded){                       // guarantee one on the very first open
    if (generateIncoming()) store.tradesSeeded = true; saveStore();
    return;
  }
  if (incoming < 2 && Math.random() < 0.3){ generateIncoming(); saveStore(); }
}

// ---------- move the players (the only place a roster actually changes) ----------
function clearFromMine(rec){
  const id = rec.id, nm = rec.n;
  [LINEUP, BENCH, TAXI].forEach(A => A.forEach(r => {
    if (r.a && ((id && String(r.a.id) === String(id)) || r.a.n === nm)) r.a = null;
  }));
}
function addToMine(rec){
  const src = (rec.id && NFL_BY_ID[rec.id]) || rec;
  const p = hydratePlayer(mkPlayer(src), S.week);
  let slot = BENCH.findIndex(r => !r.a);
  if (slot > -1) BENCH[slot].a = p; else BENCH.push({ a: p, x: null });
}
export function executeTrade(partner, send, get){
  store.tradeOwners = store.tradeOwners || {};
  send.forEach(p => { clearFromMine(p); if (p.id) store.tradeOwners[p.id] = partner;
    if (p.id && store.tradeBlock) { const bi = store.tradeBlock.indexOf(p.id); if (bi > -1) store.tradeBlock.splice(bi, 1); } });
  get.forEach(p => { if (p.id) store.tradeOwners[p.id] = MY_TEAM; addToMine(p); });
  persistRoster();
  fillSide('radiator', 'x');   // rebuild the live opponent side so it honours the new ownership
  invalidateRosters(); S.pidx = null; saveStore();
  refreshRosterViews();
}

// ---------- entry points ----------
function ensureDrawer(){ if (!document.body.classList.contains('open')) document.body.classList.add('open'); }
// the drawer's Trades rail item
export function openTradesRail(){
  mode = 'overview'; sendSel = new Set(); getSel = new Set();
  maybeIncoming();
  selectRail('trades');   // marks the rail item + renders the panel via renderPanel('trades')
}
// straight into a builder aimed at one team (from that team's screen)
export function openTradeWith(key){
  ensureDrawer();
  if (key && key !== MY_TEAM && T[key]){ mode = 'builder'; tradePartner = key; } else { mode = 'overview'; }
  sendSel = new Set(); getSel = new Set();
  maybeIncoming();
  selectRail('trades');
}
export function openTrades(){ ensureDrawer(); openTradesRail(); }
