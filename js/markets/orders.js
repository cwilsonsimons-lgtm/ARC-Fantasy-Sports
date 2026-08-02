// Arc Markets — the order book, and the positions derived from it.
//
// HARD RULE: a position exists because an order filled. Nothing else creates
// one. This module imports no league state, no roster, no lineup — a player
// appearing on the user's fantasy team grants exactly zero shares, and the only
// way to hold a contract is to have bought it here. `data.js` used to seed 28
// holdings directly; that is gone, and the seed below is a list of *fills*.
//
// A position is one signed integer. Long is positive, short is negative, and
// there is no separate short ledger to reconcile against — the same number
// covers both, which is why a single order can cross zero.
import { mkStore, saveMk, BY_ID } from './data.js';

export const START_CASH = 25000;

export function orders() {
  if (!mkStore.orders) mkStore.orders = [];
  return mkStore.orders;
}

/**
 * Walk every fill in sequence and fold it into a position.
 *
 * Adding to a position averages the cost. Reducing one realises P/L on the
 * closed portion. An order larger than the position it opposes closes what is
 * there, realises that, and opens the remainder on the other side at the fill
 * price — which is what "own 5, sell 6 → net -1" means in arithmetic.
 */
export function positions() {
  const pos = {};
  let cash = START_CASH;
  orders().forEach(o => {
    const delta = o.side === 'buy' ? o.qty : -o.qty;
    cash += (o.side === 'buy' ? -1 : 1) * o.qty * o.price;
    const p = pos[o.pid] || (pos[o.pid] = { qty: 0, avg: 0, realized: 0 });
    if (p.qty === 0 || Math.sign(p.qty) === Math.sign(delta)) {
      // opening or adding: weighted average cost
      const total = Math.abs(p.qty) + Math.abs(delta);
      p.avg = (p.avg * Math.abs(p.qty) + o.price * Math.abs(delta)) / (total || 1);
      p.qty += delta;
    } else {
      const closed = Math.min(Math.abs(p.qty), Math.abs(delta));
      // long closes for (fill - cost); short closes for (cost - fill). The sign
      // of the position being closed is what flips between the two.
      p.realized += closed * (o.price - p.avg) * Math.sign(p.qty);
      const left = Math.abs(delta) - closed;
      p.qty += delta;
      if (left > 0) p.avg = o.price;      // crossed zero: the remainder is a new position
      else if (p.qty === 0) p.avg = 0;
    }
  });
  Object.keys(pos).forEach(k => {
    pos[k].avg = Math.round(pos[k].avg * 10000) / 10000;
    pos[k].realized = Math.round(pos[k].realized * 100) / 100;
  });
  return { pos, cash: Math.round(cash * 100) / 100 };
}

/** One player's live position, marked at today's price. Zero if never traded. */
export function positionFor(pid) {
  const { pos } = positions();
  const p = pos[pid] || { qty: 0, avg: 0, realized: 0 };
  const mk = BY_ID[pid];
  const mark = mk ? mk.price : 0;
  return {
    qty: p.qty,
    avg: p.avg,
    realized: p.realized,
    mark,
    value: Math.round(p.qty * mark * 100) / 100,
    open: Math.round(p.qty * (mark - p.avg) * 100) / 100,   // works for both directions
    dayChange: Math.round(p.qty * (mk ? mk.change : 0) * 100) / 100,
  };
}

/** Every non-zero position, marked. The portfolio screen is a view of this. */
export function openPositions() {
  const { pos } = positions();
  return Object.keys(pos)
    .filter(id => pos[id].qty !== 0 && BY_ID[id])
    .map(id => {
      const p = BY_ID[id], f = positionFor(id);
      return { ...p, qty: f.qty, avg: f.avg, value: f.value, open: f.open,
               dayChange: f.dayChange, realized: f.realized };
    });
}

export function portfolioTotals() {
  const rows = openPositions();
  const { cash } = positions();
  const { pos } = positions();
  const value = rows.reduce((n, r) => n + r.value, 0);
  const dayChange = rows.reduce((n, r) => n + r.dayChange, 0);
  const realized = Object.keys(pos).reduce((n, k) => n + pos[k].realized, 0);
  const openPL = rows.reduce((n, r) => n + r.open, 0);
  const prior = value - dayChange;
  return {
    rows,
    value: Math.round(value * 100) / 100,
    dayChange: Math.round(dayChange * 100) / 100,
    dayPct: Math.round((dayChange / (prior || 1)) * 1000) / 10,
    buyingPower: Math.round(cash * 100) / 100,
    realized: Math.round(realized * 100) / 100,
    openPL: Math.round(openPL * 100) / 100,
    total: Math.round((value + cash) * 100) / 100,
  };
}

/** What a position becomes if this order fills — the ticket's bottom line. */
export function projectFill(pid, side, qty) {
  const cur = positionFor(pid).qty;
  return cur + (side === 'buy' ? qty : -qty);
}

export function execute(pid, side, qty, price) {
  qty = Math.max(1, Math.round(+qty || 0));
  if (!BY_ID[pid] || !qty) return null;
  mkStore.orderSeq = (mkStore.orderSeq || 0) + 1;
  const o = { id: 'o' + mkStore.orderSeq, pid, side, qty,
              price: Math.round(price * 100) / 100, ts: Date.now() };
  orders().push(o);
  saveMk();
  return o;
}

// ---------------------------------------------------------------- seed
// A starting order history, so the portfolio, average cost and realised P/L
// have something real to show. These are fills: the positions they produce come
// out of the same walk as any order placed in the app, not from a holdings
// table sitting beside it.
export function initOrders() {
  if (mkStore.ordersSeeded) { orders(); return; }
  mkStore.ordersSeeded = 1;
  mkStore.orders = [];
  mkStore.orderSeq = 0;
  const ids = Object.keys(BY_ID);
  const day = 86400000, now = Date.now();
  let n = 0;
  const add = (pid, side, qty, mult, daysAgo) => {
    const p = BY_ID[pid];
    if (!p) return;
    mkStore.orderSeq = ++n;
    mkStore.orders.push({ id: 'o' + n, pid, side, qty,
      price: Math.round(p.price * mult * 100) / 100, ts: now - daysAgo * day });
  };
  // a spread of longs opened at various points in the season
  ids.slice(0, 14).forEach((id, i) => add(id, 'buy', 20 + (i % 4) * 15, 0.88 + (i % 7) * 0.03, 40 - i));
  // one position trimmed, so realised P/L is not zero
  if (ids[2]) add(ids[2], 'sell', 15, 1.06, 9);
  // one sold through zero, so a short exists without a short screen to hold it
  if (ids[5]) add(ids[5], 'sell', 60, 1.02, 6);
  // and one shorted outright, then partly covered
  if (ids[18]) { add(ids[18], 'sell', 30, 1.09, 12); add(ids[18], 'buy', 10, 0.94, 4); }
  saveMk();
}
