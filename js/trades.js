import { S } from './state.js';
import { MY_TEAM, T } from './data/teams.js';
import { NFL_BY_ID } from './data/nfl-players.js';
import { hydratePlayer } from './data/nfl-index.js';
import { draftDone, fillSide, mkPlayer } from './draft.js';
import { invalidateRosters, persistRoster, refreshRosterViews } from './freeagency.js';
import { homeTab, showView, toast, toggleDrawer } from './nav.js';
import { faceInner, pKeyOf } from './player.js';
import { BENCH, LINEUP, TAXI, markInner, saveStore, store } from './store.js';
import { esc, rosterFor } from './team.js';

// ======================= TRADE CENTER =======================
// A trade in this prototype always has one real side — yours (MY_TEAM) — and one
// counterpart. Accepting one moves players through store.tradeOwners, the single
// ownership seam teamRosterIds() honours, so a player is never on two rosters.

// ---- view state (reset each time you leave the builder) ----
export let tradeTab = 'propose';        // propose | pending | history
export let tradePartner = null;         // the other team's key
export let sendSel = new Set();         // pKeyOf() of my players going out
export let getSel = new Set();          // pKeyOf() of their players coming in

// ---- value: a player is worth their season projection (same yardstick Markets prices on) ----
export function assetValue(p){
  const rec = p && p.id && NFL_BY_ID[p.id];
  if (rec && rec.sproj != null) return rec.sproj;
  return Math.round((p && p.proj || 0) * 17);
}
export function tradeTeams(){ return Object.keys(T).filter(k => k !== MY_TEAM); }
function mgrOf(key){ return (T[key] && T[key].mgr) || key; }

// each manager has a stable appetite for a deal: they accept when the value they
// receive is at least this fraction of what they give up. Seeded from the key so
// it never changes between reloads or screenshots.
function toughness(key){
  let h = 2166136261;
  for (let i = 0; i < key.length; i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.88 + ((h >>> 0) % 90) / 1000;   // 0.88 – 0.97
}

// ---- selection helpers ----
function selList(roster, sel){ return roster.filter(p => sel.has(pKeyOf(p))); }
function sum(list){ return list.reduce((t, p) => t + assetValue(p), 0); }
export function tradeToggle(side, key){
  const sel = side === 'send' ? sendSel : getSel;
  if (sel.has(key)) sel.delete(key); else sel.add(key);
  renderTrades();
}
export function pickTradePartner(key){
  tradePartner = key; sendSel = new Set(); getSel = new Set(); renderTrades();
  document.getElementById('scroll').scrollTop = 0;
}
export function clearTradePartner(){ tradePartner = null; sendSel = new Set(); getSel = new Set(); renderTrades(); }
export function setTradeTab(k){ tradeTab = k; renderTrades(); document.getElementById('scroll').scrollTop = 0; }

// ---- crest chip ----
function crest(key, size){
  const t = T[key];
  return `<span class="trd-crest" style="width:${size}px;height:${size}px;background:linear-gradient(155deg,${t.bg},#0d1108);border:1.5px solid ${t.c};color:${t.c}">${markInner(t)}</span>`;
}

// ---- rows ----
function selRow(p, side){
  const k = pKeyOf(p), on = (side === 'send' ? sendSel : getSel).has(k);
  return `<div class="trd-row${on ? ' on' : ''}" onclick="tradeToggle('${side}','${esc(k)}')">
    <span class="trd-chk">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-11"/></svg>' : ''}</span>
    <span class="trd-face">${faceInner(k)}</span>
    <div class="trd-info"><div class="trd-nm">${p.n}</div>
      <div class="trd-mt"><span class="pos ${p.pos}">${p.pos}</span> · ${p.tm}${p.bye ? ` (${p.bye})` : ''}</div></div>
    <span class="trd-val">${assetValue(p).toFixed(0)}</span>
  </div>`;
}
function rosterCol(key, roster, side){
  const label = side === 'send' ? 'You send' : 'You get';
  const rows = roster.length
    ? roster.map(p => selRow(p, side)).join('')
    : `<div class="trd-empty-col">No players</div>`;
  return `<div class="trd-col">
    <div class="trd-col-hd">${crest(key, 20)}<span>${label}</span></div>
    <div class="trd-col-body">${rows}</div>
  </div>`;
}

// ---- summary / verdict ----
function verdict(give, get){
  if (!give && !get) return { cls: 'idle', t: 'Pick players from both sides' };
  if (!give || !get)  return { cls: 'idle', t: 'Add a player to each side' };
  const diff = get - give, big = Math.max(give, get);
  if (Math.abs(diff) <= big * 0.08) return { cls: 'fair', t: 'Even trade' };
  return diff > 0
    ? { cls: 'win',  t: 'You come out ahead' }
    : { cls: 'lose', t: 'You give up more value' };
}
function summaryHTML(give, get){
  const v = verdict(give, get);
  return `<div class="trd-sum">
    <div class="trd-sum-cols">
      <div class="trd-sum-c"><div class="k">You send</div><div class="v">${give.toFixed(0)}</div></div>
      <div class="trd-sum-swap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h13l-3-3M17 16H4l3 3"/></svg></div>
      <div class="trd-sum-c"><div class="k">You get</div><div class="v">${get.toFixed(0)}</div></div>
    </div>
    <div class="trd-verdict ${v.cls}">${v.t}</div>
  </div>`;
}

// ---- summary line for a stored deal (pending / history) ----
function names(list){ return list.map(p => p.n).join(', ') || '—'; }
function dealCard(d, opts){
  const o = opts || {};
  const badge = o.badge ? `<span class="trd-badge ${o.badge.cls}">${o.badge.t}</span>` : '';
  return `<div class="trd-deal">
    <div class="trd-deal-hd">${crest(d.partner, 22)}<span class="trd-deal-nm">${T[d.partner] ? T[d.partner].n : d.partner}</span>${badge}</div>
    <div class="trd-deal-line"><span class="trd-deal-dir out">OUT</span>${names(d.send)}</div>
    <div class="trd-deal-line"><span class="trd-deal-dir in">IN</span>${names(d.get)}</div>
    ${d.note ? `<div class="trd-deal-note">${d.note}</div>` : ''}
    ${o.actions || ''}
  </div>`;
}

// ---- subtab bar ----
function tabsHTML(){
  const pend = store.tradesPending.length;
  const tabs = [['propose', 'Propose'], ['pending', `Pending${pend ? ` <span class="trd-pill">${pend}</span>` : ''}`], ['history', 'History']];
  return `<div class="trd-tabs">${tabs.map(t =>
    `<div class="trd-tab${t[0] === tradeTab ? ' on' : ''}" onclick="setTradeTab('${t[0]}')">${t[1]}</div>`).join('')}</div>`;
}

// ---- bodies ----
function proposeBody(){
  if (!tradePartner){
    const chips = tradeTeams().map(k => {
      const t = T[k];
      return `<div class="trd-team" onclick="pickTradePartner('${k}')">
        ${crest(k, 40)}
        <div class="trd-team-i"><div class="trd-team-n tf-${k}" style="color:${t.c}">${t.n}</div>
          <div class="trd-team-m">${t.mgr} · ${t.rec}</div></div>
        <span class="trd-team-go">›</span>
      </div>`;
    }).join('');
    return `<div class="trd-lead">Who do you want to trade with?</div>
      <div class="trd-teams">${chips}</div>`;
  }
  const mine  = rosterFor(MY_TEAM) || [];
  const yours = rosterFor(tradePartner) || [];
  const give = sum(selList(mine, sendSel)), get = sum(selList(yours, getSel));
  const ready = sendSel.size && getSel.size;
  return `<div class="trd-partner">
      ${crest(tradePartner, 34)}
      <div class="trd-partner-i"><div class="trd-partner-n tf-${tradePartner}" style="color:${T[tradePartner].c}">${T[tradePartner].n}</div>
        <div class="trd-partner-m">${T[tradePartner].mgr} · ${T[tradePartner].rec}</div></div>
      <span class="trd-change" onclick="clearTradePartner()">Change</span>
    </div>
    <div class="trd-cols">${rosterCol(MY_TEAM, mine, 'send')}${rosterCol(tradePartner, yours, 'get')}</div>
    ${summaryHTML(give, get)}
    <div class="trd-cta${ready ? '' : ' off'}" onclick="${ready ? 'proposeTrade()' : ''}">Propose Trade</div>`;
}
function pendingBody(){
  if (!store.tradesPending.length)
    return `<div class="trd-blank"><div class="trd-blank-t">No pending trades</div><div class="trd-blank-s">Propose one and it shows up here while the other manager decides.</div></div>`;
  return store.tradesPending.map(d => dealCard(d, {
    badge: { cls: 'wait', t: `Waiting on ${mgrOf(d.partner)}` },
    actions: `<div class="trd-deal-btns"><div class="trd-mini danger" onclick="cancelTrade('${d.id}')">Cancel offer</div></div>`
  })).join('');
}
function historyBody(){
  if (!store.trades.length)
    return `<div class="trd-blank"><div class="trd-blank-t">No trade history yet</div><div class="trd-blank-s">Accepted and rejected trades are logged here.</div></div>`;
  return store.trades.map(d => dealCard(d, {
    badge: d.status === 'accepted' ? { cls: 'ok', t: 'Accepted' } : { cls: 'no', t: 'Rejected' }
  })).join('');
}

export function renderTrades(){
  const el = document.getElementById('tradeBody'); if (!el) return;
  if (!draftDone()){
    el.innerHTML = `<div class="trd-h">Trades</div>
      <div class="trd-blank"><div class="trd-blank-t">Trades open after the draft</div>
      <div class="trd-blank-s">Once every pick is in, you can start shopping your roster.</div></div>`;
    return;
  }
  const body = tradeTab === 'pending' ? pendingBody() : tradeTab === 'history' ? historyBody() : proposeBody();
  el.innerHTML = `<div class="trd-h">Trades</div>
    <div class="trd-sub">City Boys Dynasty · ${tradeTeams().length} other managers</div>
    ${tabsHTML()}
    ${body}`;
}

// ---- lightweight record of a player for storage ----
function slim(p){ return { id: p.id || null, n: p.n, pos: p.pos, tm: p.tm, proj: p.proj != null ? p.proj : null, val: assetValue(p) }; }
function uid(){ return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

// ---- propose ----
export function proposeTrade(){
  const mine  = rosterFor(MY_TEAM) || [];
  const yours = rosterFor(tradePartner) || [];
  const send = selList(mine, sendSel), get = selList(yours, getSel);
  if (!send.length || !get.length){ toast('Add a player to each side'); return; }
  const deal = { id: uid(), partner: tradePartner, send: send.map(slim), get: get.map(slim), ts: Date.now(), status: 'pending' };
  store.tradesPending.unshift(deal);
  saveStore();
  const mgr = mgrOf(tradePartner);
  sendSel = new Set(); getSel = new Set(); tradePartner = null; tradeTab = 'pending';
  renderTrades();
  toast(`Offer sent to ${mgr}`);
  setTimeout(() => resolveTrade(deal.id), 1600);   // the other manager "reviews" it
}

// ---- the counterpart decides ----
export function resolveTrade(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  const d = store.tradesPending[i];
  const give = d.send.reduce((t, p) => t + (p.val || 0), 0);   // value they receive
  const get  = d.get.reduce((t, p) => t + (p.val || 0), 0);    // value they give up
  const accept = give >= get * toughness(d.partner);
  store.tradesPending.splice(i, 1);
  const mgr = mgrOf(d.partner);
  if (accept){
    d.status = 'accepted';
    d.note = `${mgr} accepted your offer.`;
    executeTrade(d.partner, d.send, d.get);
    toast(`${mgr} accepted the trade`);
  } else {
    d.status = 'rejected';
    d.note = give >= get * (toughness(d.partner) - 0.06)
      ? `${mgr} passed — close, but wanted a bit more back.`
      : `${mgr} rejected it — the value was too far in your favour.`;
    toast(`${mgr} rejected the trade`);
  }
  d.resolvedTs = Date.now();
  store.trades.unshift(d);
  saveStore();
  if (document.querySelector('.view[data-view="trade"].on')) renderTrades();
}

// ---- move the players (the only place a roster actually changes) ----
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
  send.forEach(p => { clearFromMine(p); if (p.id) store.tradeOwners[p.id] = partner; });
  get.forEach(p => { if (p.id) store.tradeOwners[p.id] = MY_TEAM; addToMine(p); });
  persistRoster();
  fillSide('radiator', 'x');   // rebuild the live opponent side so it honours the new ownership
  invalidateRosters(); S.pidx = null; saveStore();
  refreshRosterViews();
}

// ---- cancel a pending offer ----
export function cancelTrade(id){
  const i = store.tradesPending.findIndex(d => d.id === id);
  if (i < 0) return;
  store.tradesPending.splice(i, 1); saveStore(); renderTrades();
  toast('Offer withdrawn');
}

// ---- open, mirroring openSettings() ----
export function openTrades(){
  renderTrades();
  showView('trade');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.getElementById('scroll').scrollTop = 0;
  if (document.body.classList.contains('open')) toggleDrawer();
}
// jump straight into a builder aimed at one team (from that team's screen)
export function openTradeWith(key){
  tradeTab = 'propose';
  tradePartner = (key && key !== MY_TEAM && T[key]) ? key : null;
  sendSel = new Set(); getSel = new Set();
  openTrades();
}
