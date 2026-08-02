// Arc Markets — positions, orders and the account.
//
// Everything a user owns lives here. Shares are fractional throughout (0.25,
// 1.73, 14.682 are all valid sizes); a position is a signed quantity, so a
// short is simply a negative one.
//
// THE NO-HEDGE RULE
// A user may not be long and short the same PLAYER at the same time — not just
// the same contract. Being long the season and short the 3-year would be a
// hedge across the same underlying, which the spec forbids, so exposure
// direction is enforced per player across every term. An order that would cross
// through flat into the opposite side is refused rather than silently split;
// the user closes first, then opens the other way.
import { MIN_QTY, getEngine, round2, roundQty } from './engine.js';
import { DEFAULT_TERM, SEASON, parseSymbol, symbolFor, termAvailable } from './contracts.js';

export const START_CASH = 25000;

// ---------------------------------------------------------------- state
// Persisted separately from the fantasy store: the market is global, so it must
// not live inside anything that is per-league.
const KEY = 'arc_ledger_v1';
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }

export const acct = load();
acct.cash = acct.cash == null ? START_CASH : acct.cash;
acct.deposits = acct.deposits == null ? START_CASH : acct.deposits;  // basis for total return
acct.positions = acct.positions || {};   // sym -> {sym, qty, avg, opened, term, playerId}
acct.orders = acct.orders || [];         // working + historical orders
acct.fills = acct.fills || [];           // the user's own tape
acct.closed = acct.closed || [];         // positions closed by trading out of them
acct.settled = acct.settled || [];       // contracts closed by expiry or retirement
acct.realized = acct.realized || 0;

export function saveLedger() {
  try { localStorage.setItem(KEY, JSON.stringify(acct)); } catch (e) { /* quota */ }
}

// ---------------------------------------------------------------- positions
export function positionFor(sym) { return acct.positions[sym] || null; }
export function positions() { return Object.values(acct.positions).filter(p => Math.abs(p.qty) >= MIN_QTY); }
export function positionsForPlayer(playerId) { return positions().filter(p => p.playerId === playerId); }

/** 'long' | 'short' | null — the user's committed direction on this player. */
export function playerSide(playerId) {
  let net = 0;
  positionsForPlayer(playerId).forEach(p => { net += p.qty; });
  if (net >= MIN_QTY) return 'long';
  if (net <= -MIN_QTY) return 'short';
  return null;
}
/** Total shares held on this player, signed, across every term. */
export function playerExposure(playerId) {
  return roundQty(positionsForPlayer(playerId).reduce((n, p) => n + p.qty, 0));
}

// ---------------------------------------------------------------- validation
export const ACTIONS = {
  buy:   { side: 'buy',  dir: 1,  opens: 'long',  label: 'Buy' },
  sell:  { side: 'sell', dir: -1, closes: 'long', label: 'Sell' },
  short: { side: 'sell', dir: -1, opens: 'short', label: 'Short' },
  cover: { side: 'buy',  dir: 1,  closes: 'short', label: 'Cover' },
};

/**
 * Can this order be placed? Returns {ok} or {ok:false, reason}.
 * This is the single gate every path goes through, so no UI route can create a
 * box position by accident.
 */
export function validate({ action, sym, qty, type, limit }) {
  const a = ACTIONS[action];
  if (!a) return { ok: false, reason: 'Unknown order type' };
  const q = roundQty(qty);
  if (!(q >= MIN_QTY)) return { ok: false, reason: `Minimum size is ${MIN_QTY} shares` };
  if (type === 'limit' && !(limit > 0)) return { ok: false, reason: 'Enter a limit price' };

  const { playerId, term } = parseSymbol(sym);
  if (!termAvailable(playerId, term))
    return { ok: false, reason: 'That contract length is not offered for this player' };

  const pos = positionFor(sym);
  const held = pos ? pos.qty : 0;
  const side = playerSide(playerId);

  // closing orders can never exceed what is actually held on THIS contract
  if (a.closes === 'long') {
    if (held < MIN_QTY) return { ok: false, reason: 'You have no shares of this contract to sell' };
    if (q > held + 1e-9) return { ok: false, reason: `You only hold ${held} shares` };
  }
  if (a.closes === 'short') {
    if (held > -MIN_QTY) return { ok: false, reason: 'You have no short position to cover' };
    if (q > -held + 1e-9) return { ok: false, reason: `Your short is ${roundQty(-held)} shares` };
  }
  // opening orders may not contradict the direction already taken on the player
  if (a.opens === 'long' && side === 'short')
    return { ok: false, reason: 'You are short this player — cover that position before going long' };
  if (a.opens === 'short' && side === 'long')
    return { ok: false, reason: 'You are long this player — sell those shares before going short' };

  if (a.side === 'buy' && type === 'limit') {
    const cost = q * limit;
    if (cost > acct.cash + 1e-9)
      return { ok: false, reason: `Not enough cash — that order needs $${cost.toFixed(2)}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- applying
function applyFill(sym, action, qty, px) {
  const a = ACTIONS[action];
  const { playerId, term } = parseSymbol(sym);
  const signed = a.dir * qty;                 // + adds long / reduces short
  const pos = acct.positions[sym] ||
    (acct.positions[sym] = { sym, playerId, term, qty: 0, avg: 0, opened: Date.now(), startSeason: SEASON });

  const before = pos.qty;
  const after = roundQty(before + signed);
  const cash = -a.dir * qty * px;             // buying spends, selling receives

  // average cost only resets when exposure grows in the direction already held
  let bookedPl = 0;
  if (before === 0 || Math.sign(before) === Math.sign(signed)) {
    const tot = Math.abs(before) + qty;
    pos.avg = round2((Math.abs(before) * pos.avg + qty * px) / (tot || 1));
  } else {
    const closedQty = Math.min(qty, Math.abs(before));
    const perShare = before > 0 ? px - pos.avg : pos.avg - px;
    bookedPl = round2(perShare * closedQty);
    acct.realized = round2((acct.realized || 0) + bookedPl);
    pos.realized = round2((pos.realized || 0) + bookedPl);
  }
  pos.qty = after;
  acct.cash = round2(acct.cash + cash);
  acct.fills.push({ ts: Date.now(), sym, action, qty: roundQty(qty), px: round2(px), pl: bookedPl });
  if (acct.fills.length > 500) acct.fills.splice(0, acct.fills.length - 500);
  // A position traded flat becomes a closed position, kept for the Portfolio's
  // history — realized P&L would otherwise only exist as an account total.
  if (Math.abs(after) < MIN_QTY) {
    acct.closed.unshift({
      ts: Date.now(), sym, playerId: pos.playerId, term: pos.term,
      opened: pos.opened, avg: pos.avg, exit: round2(px),
      qty: roundQty(Math.abs(before)), side: before > 0 ? 'long' : 'short',
      pl: round2(pos.realized || bookedPl), reason: 'closed',
    });
    if (acct.closed.length > 200) acct.closed.length = 200;
    delete acct.positions[sym];
  }
  return pos;
}

// ---------------------------------------------------------------- orders
let seq = 1;
/**
 * Place an order. Market orders execute against whatever engine is live; limit
 * orders that cannot trade rest (order book) or wait for the price to come to
 * them (AMM), and are re-checked by `sweepResting()`.
 */
export function placeOrder({ action, sym, qty, type = 'market', limit = null, who = 'user' }) {
  const v = validate({ action, sym, qty, type, limit });
  if (!v.ok) return { ok: false, reason: v.reason };

  const a = ACTIONS[action];
  const res = getEngine().submit({ sym, side: a.side, qty: roundQty(qty), type, limit, who });

  if (res.status === 'rejected')
    return { ok: false, reason: res.reason || 'Order rejected' };

  const order = {
    id: 'ord' + (seq++) + '-' + Date.now().toString(36),
    ts: Date.now(), action, sym, type, limit: limit ? round2(limit) : null,
    qty: roundQty(qty), filled: res.filled || 0, avg: res.avg || 0,
    status: res.status, restingId: res.resting ? res.resting.id : null,
  };
  if (res.filled >= MIN_QTY) applyFill(sym, action, res.filled, res.avg);
  acct.orders.unshift(order);
  if (acct.orders.length > 200) acct.orders.length = 200;
  saveLedger();
  return { ok: true, order, fills: res.fills || [] };
}

export function workingOrders() {
  return acct.orders.filter(o => o.status === 'resting' || o.status === 'partial');
}
export function cancelOrder(id) {
  const o = acct.orders.find(x => x.id === id);
  if (!o) return false;
  if (o.restingId) getEngine().cancel(o.sym, o.restingId);
  o.status = 'cancelled';
  saveLedger();
  return true;
}
/**
 * Re-test resting limits against the current market. The order book fills them
 * on its own as flow arrives; the AMM has nowhere to rest them, so they are
 * retried here whenever the price moves.
 */
export function sweepResting() {
  let touched = false;
  workingOrders().forEach(o => {
    const remaining = roundQty(o.qty - o.filled);
    if (remaining < MIN_QTY) { o.status = 'filled'; return; }
    const a = ACTIONS[o.action];
    const q = getEngine().quote(o.sym);
    if (!q) return;
    const px = a.side === 'buy' ? (q.ask != null ? q.ask : q.mid) : (q.bid != null ? q.bid : q.mid);
    const hits = a.side === 'buy' ? px <= o.limit + 1e-9 : px >= o.limit - 1e-9;
    if (!hits) return;
    const v = validate({ action: o.action, sym: o.sym, qty: remaining, type: 'market' });
    if (!v.ok) { o.status = 'cancelled'; o.reason = v.reason; touched = true; return; }
    const res = getEngine().submit({ sym: o.sym, side: a.side, qty: remaining, type: 'market', who: 'user' });
    if (res.filled >= MIN_QTY) {
      applyFill(o.sym, o.action, res.filled, res.avg);
      o.filled = roundQty(o.filled + res.filled);
      o.avg = res.avg;
      o.status = o.filled >= o.qty - 1e-9 ? 'filled' : 'partial';
      touched = true;
    }
  });
  if (touched) saveLedger();
  return touched;
}

// ---------------------------------------------------------------- valuation
export function markPrice(sym) {
  const q = getEngine().quote(sym);
  return q ? (q.last != null ? q.last : q.mid) : 0;
}
export function positionRows() {
  return positions().map(p => {
    const px = markPrice(p.sym);
    const value = round2(p.qty * px);
    const cost = round2(p.qty * p.avg);
    const { playerId, term } = parseSymbol(p.sym);
    const q = statsFn ? statsFn(playerId, term) : null;
    // a position's day move is its size times the contract's day move
    const dayPl = q ? round2(p.qty * q.dayChange) : 0;
    return { ...p, px, value, cost, side: p.qty < 0 ? 'short' : 'long',
             dayPl, dayPct: q ? q.dayPct : 0,
             pl: round2(value - cost),
             plPct: cost ? round2(((value - cost) / Math.abs(cost)) * 100) : 0 };
  });
}
// quotes.js imports the ledger, so it is injected rather than imported back.
let statsFn = null;
export function bindQuoteStats(fn) { statsFn = fn; }
/**
 * Everything the Portfolio screen displays, derived from real positions at the
 * current market price. Recomputed on every read, so it tracks the tape.
 */
export function accountSummary() {
  const rows = positionRows();
  const long = rows.filter(r => r.qty > 0).reduce((n, r) => n + r.value, 0);
  const short = rows.filter(r => r.qty < 0).reduce((n, r) => n + r.value, 0);
  const unrealized = rows.reduce((n, r) => n + r.pl, 0);
  const cost = rows.reduce((n, r) => n + Math.abs(r.cost), 0);
  const equity = acct.cash + long + short;
  const deposits = acct.deposits || START_CASH;
  const dayChange = rows.reduce((n, r) => n + r.dayPl, 0);
  // Shorts tie up collateral rather than freeing cash, so buying power is cash
  // less the value of what would have to be bought back.
  const buyingPower = round2(Math.max(0, acct.cash + short));
  return {
    cash: round2(acct.cash), rows,
    longValue: round2(long), shortValue: round2(short),
    costBasis: round2(cost),
    equity: round2(equity),
    buyingPower,
    unrealized: round2(unrealized), realized: round2(acct.realized || 0),
    totalReturn: round2(equity - deposits),
    totalReturnPct: deposits ? round2(((equity - deposits) / deposits) * 100) : 0,
    dayChange: round2(dayChange),
    dayPct: equity - dayChange ? round2((dayChange / (equity - dayChange)) * 100) : 0,
    deposits: round2(deposits),
    openCount: rows.length,
    closed: acct.closed, settled: acct.settled,
  };
}
/** Open + closed, newest first — the Portfolio's history tab. */
export function closedRows() {
  return acct.closed.concat(acct.settled.map(s => ({ ...s, reason: s.reason || 'settled' })))
    .sort((a, b) => b.ts - a.ts);
}

// ---------------------------------------------------------------- settlement
/**
 * Close every position on a contract at its settlement value and book the P&L.
 * Called when a term expires or a player retires — never for roster moves.
 */
export function settlePositions(sym, settleValue, reason) {
  const pos = positionFor(sym);
  if (!pos) return null;
  const perShare = pos.qty > 0 ? settleValue - pos.avg : pos.avg - settleValue;
  const pl = round2(perShare * Math.abs(pos.qty));
  acct.cash = round2(acct.cash + pos.qty * settleValue);
  acct.realized = round2((acct.realized || 0) + pl);
  acct.settled.unshift({ ts: Date.now(), sym, qty: pos.qty, avg: pos.avg,
                         settleValue: round2(settleValue), pl, reason });
  delete acct.positions[sym];
  // any working orders on a settled contract are void
  acct.orders.forEach(o => { if (o.sym === sym && (o.status === 'resting' || o.status === 'partial')) o.status = 'void'; });
  saveLedger();
  return { sym, pl, reason };
}

/** Explicit user/administrator reset — the only thing that clears holdings. */
export function resetLedger() {
  acct.cash = START_CASH; acct.deposits = START_CASH;
  acct.positions = {}; acct.orders = []; acct.fills = [];
  acct.closed = []; acct.settled = []; acct.realized = 0;
  saveLedger();
}
