// Arc Markets — the matching layer.
//
// THE POINT OF THIS FILE: nothing above it knows how liquidity is provided.
// Callers submit an order and read a quote; whether the other side of that
// trade is another user (order book) or the platform (AMM) is decided here and
// nowhere else. Both models are implemented, both satisfy the same interface,
// and `setEngine()` swaps them at runtime — so moving from one market structure
// to the other is a config change, not a rewrite.
//
// A LiquidityEngine implements:
//   quote(sym)            -> {bid, ask, last, mid, spread, depth}
//   submit(order)         -> {status, fills:[{qty,px}], filled, avg, resting}
//   cancel(sym, orderId)  -> boolean
//   open(sym)             -> resting orders for this symbol
//   seed(sym, px)         -> establish an opening print (once, at listing)
//
// An `order` is {sym, side:'buy'|'sell', qty, type:'market'|'limit', limit?, who?}.
// `qty` is fractional throughout — shares are floats, never integers.
//
// PRICE IS ALWAYS THE RESULT OF A TRADE. No method here sets a price directly;
// `last` only ever changes because a fill happened. That is what keeps the rule
// "events influence traders, traders move the market" true by construction —
// news reaches the market only by way of somebody submitting an order.

export const TICK = 0.01;                 // quotes round to the cent
export const MIN_QTY = 0.001;             // smallest tradable slice of a share

export const round2 = n => Math.round(n * 100) / 100;
export const roundQty = n => Math.round(n * 1000) / 1000;

/** Every fill any engine produces passes through here, so tape is uniform. */
function print(book, qty, px, side, who) {
  const t = { ts: Date.now(), qty: roundQty(qty), px: round2(px), side, who: who || 'user' };
  book.last = t.px;
  book.tape.push(t);
  if (book.tape.length > 400) book.tape.splice(0, book.tape.length - 400);
  book.vol += t.qty;
  book.trades += 1;
  if (side === 'buy') book.buyVol += t.qty; else book.sellVol += t.qty;
  return t;
}

function newBook(sym, px) {
  return { sym, last: round2(px), anchor: round2(px), bids: [], asks: [],
           tape: [], vol: 0, trades: 0, buyVol: 0, sellVol: 0, inv: 0, seq: 1 };
}

// ---------------------------------------------------------------- base
class BaseEngine {
  constructor() { this.books = {}; this.subs = []; }
  book(sym) { return this.books[sym] || null; }
  seed(sym, px) {
    if (!this.books[sym]) this.books[sym] = newBook(sym, px);
    return this.books[sym];
  }
  /** Notified after any fill, so views can repaint off real trades. */
  onTrade(cb) { this.subs.push(cb); return () => { const i = this.subs.indexOf(cb); if (i > -1) this.subs.splice(i, 1); }; }
  emit(sym, fills) { if (fills.length) this.subs.forEach(cb => { try { cb(sym, fills); } catch (e) {} }); }
  last(sym) { const b = this.book(sym); return b ? b.last : null; }
  tape(sym) { const b = this.book(sym); return b ? b.tape : []; }
  /** Session counters every engine exposes the same way. */
  stats(sym) {
    const b = this.book(sym);
    if (!b) return { vol: 0, trades: 0, buyVol: 0, sellVol: 0, buyRatio: 0.5 };
    const tot = b.buyVol + b.sellVol;
    return { vol: roundQty(b.vol), trades: b.trades, buyVol: roundQty(b.buyVol),
             sellVol: roundQty(b.sellVol), buyRatio: tot ? b.buyVol / tot : 0.5 };
  }
  open() { return []; }
  cancel() { return false; }
}

// ---------------------------------------------------------------- AMM
// The platform is always the counterparty, so an order never waits. Price is a
// function of net inventory the maker has absorbed: every share bought from the
// pool pushes the price up, every share sold into it pushes down. `depth` is
// how many shares move the price by one e-fold — larger = deeper = less impact.
//
// This is still trade-driven pricing: the curve only moves when someone trades
// against it, and a market that nobody touches does not drift.
export class AmmEngine extends BaseEngine {
  constructor({ depth = 900, spread = 0.004 } = {}) {
    super(); this.depth = depth; this.spreadPct = spread; this.kind = 'amm';
  }
  /** Mid price implied by current inventory. */
  mid(b) { return b.anchor * Math.exp(b.inv / this.depth); }
  /**
   * Average price for `qty` shares in `side`, integrating the curve rather than
   * quoting the touch — a large order pays for the impact it causes.
   */
  fillPrice(b, side, qty) {
    const s = side === 'buy' ? 1 : -1;
    const i0 = b.inv, i1 = b.inv + s * qty;
    // ∫ anchor*e^(i/d) di  /  qty
    const avg = qty <= 0 ? this.mid(b)
      : (b.anchor * this.depth * (Math.exp(i1 / this.depth) - Math.exp(i0 / this.depth))) / (s * qty);
    return Math.max(TICK, avg * (1 + s * this.spreadPct / 2));
  }
  quote(sym) {
    const b = this.book(sym);
    if (!b) return null;
    const m = this.mid(b);
    const half = m * this.spreadPct / 2;
    return { bid: round2(Math.max(TICK, m - half)), ask: round2(m + half), mid: round2(m),
             last: b.last, spread: round2(half * 2), depth: this.depthLadder(sym) };
  }
  /** Synthetic ladder: what successive slices would cost on the curve. */
  depthLadder(sym, levels = 5, step = 25) {
    const b = this.book(sym); if (!b) return [];
    const out = [];
    for (let i = 1; i <= levels; i++) {
      out.push({ side: 'bid', px: round2(this.fillPrice(b, 'sell', step * i)), qty: step });
      out.push({ side: 'ask', px: round2(this.fillPrice(b, 'buy', step * i)), qty: step });
    }
    return out;
  }
  submit(o) {
    const b = this.seed(o.sym, o.px || 1);
    const qty = roundQty(o.qty);
    if (qty < MIN_QTY) return { status: 'rejected', reason: 'Size too small', fills: [], filled: 0, avg: 0 };
    const px = this.fillPrice(b, o.side, qty);
    // A limit order only trades if the pool's price is at least as good.
    if (o.type === 'limit') {
      const ok = o.side === 'buy' ? px <= o.limit + 1e-9 : px >= o.limit - 1e-9;
      if (!ok) return { status: 'resting', fills: [], filled: 0, avg: 0, resting: true,
                        reason: `AMM price ${round2(px).toFixed(2)} is outside your limit` };
    }
    b.inv += (o.side === 'buy' ? 1 : -1) * qty;
    const t = print(b, qty, px, o.side, o.who);
    this.emit(o.sym, [t]);
    return { status: 'filled', fills: [t], filled: qty, avg: t.px };
  }
}

// ---------------------------------------------------------------- order book
// Users trade with each other. Price-time priority, partial fills, resting
// limits and real depth. Identical surface to the AMM above, so the app cannot
// tell which one it is talking to.
export class OrderBookEngine extends BaseEngine {
  constructor() { super(); this.kind = 'book'; }
  quote(sym) {
    const b = this.book(sym);
    if (!b) return null;
    const bid = b.bids.length ? b.bids[0].px : null;
    const ask = b.asks.length ? b.asks[0].px : null;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : (b.last || b.anchor);
    return { bid, ask, mid: round2(mid), last: b.last,
             spread: bid != null && ask != null ? round2(ask - bid) : null,
             depth: this.depthLadder(sym) };
  }
  depthLadder(sym, levels = 5) {
    const b = this.book(sym); if (!b) return [];
    const agg = (side, arr) => {
      const by = new Map();
      arr.forEach(o => by.set(o.px, (by.get(o.px) || 0) + o.qty));
      return [...by.entries()].slice(0, levels).map(([px, qty]) => ({ side, px, qty: roundQty(qty) }));
    };
    return agg('bid', b.bids).concat(agg('ask', b.asks));
  }
  open(sym, who) {
    const b = this.book(sym); if (!b) return [];
    return b.bids.concat(b.asks).filter(o => !who || o.who === who);
  }
  cancel(sym, id) {
    const b = this.book(sym); if (!b) return false;
    for (const arr of [b.bids, b.asks]) {
      const i = arr.findIndex(o => o.id === id);
      if (i > -1) { arr.splice(i, 1); return true; }
    }
    return false;
  }
  /** bids: high→low, asks: low→high, ties broken by arrival order. */
  insert(b, o) {
    const arr = o.side === 'buy' ? b.bids : b.asks;
    const better = o.side === 'buy' ? (a, x) => a.px > x.px : (a, x) => a.px < x.px;
    let i = 0;
    while (i < arr.length && (better(arr[i], o) || (arr[i].px === o.px && arr[i].seq < o.seq))) i++;
    arr.splice(i, 0, o);
  }
  submit(o) {
    const b = this.seed(o.sym, o.px || 1);
    let left = roundQty(o.qty);
    if (left < MIN_QTY) return { status: 'rejected', reason: 'Size too small', fills: [], filled: 0, avg: 0 };
    const opp = o.side === 'buy' ? b.asks : b.bids;
    const crosses = px => o.type === 'market' ? true
      : (o.side === 'buy' ? px <= o.limit + 1e-9 : px >= o.limit - 1e-9);
    const fills = [];
    while (left >= MIN_QTY && opp.length && crosses(opp[0].px)) {
      const top = opp[0];
      const take = Math.min(left, top.qty);
      fills.push(print(b, take, top.px, o.side, o.who));
      top.qty = roundQty(top.qty - take);
      left = roundQty(left - take);
      if (top.qty < MIN_QTY) opp.shift();
    }
    this.emit(o.sym, fills);
    const filled = roundQty(o.qty - left);
    const avg = filled ? round2(fills.reduce((n, f) => n + f.px * f.qty, 0) / filled) : 0;
    // Unfilled limit size rests; unfilled market size is simply not available.
    let resting = null;
    if (left >= MIN_QTY && o.type === 'limit') {
      resting = { id: 'o' + (b.seq++), sym: o.sym, side: o.side, px: round2(o.limit),
                  qty: left, who: o.who || 'user', ts: Date.now(), seq: b.seq };
      this.insert(b, resting);
    }
    return {
      status: filled >= roundQty(o.qty) ? 'filled' : filled > 0 ? (resting ? 'partial' : 'partial-nofill')
             : resting ? 'resting' : 'rejected',
      reason: !filled && !resting ? 'No liquidity at that price' : undefined,
      fills, filled, avg, resting,
    };
  }
}

// ---------------------------------------------------------------- selection
// AMM is the default: with one real user and simulated flow, a book would sit
// empty for most players and the spec's "low-volume players become illiquid"
// downside would be the whole experience. The book is fully built and can be
// switched on the moment there are enough participants to fill it.
const ENGINES = { amm: () => new AmmEngine(), book: () => new OrderBookEngine() };
let engine = ENGINES.amm();

export function getEngine() { return engine; }
export function engineKind() { return engine.kind; }
/** Swap market structure. Books are re-seeded from the previous last prints. */
export function setEngine(kind) {
  if (!ENGINES[kind] || kind === engine.kind) return engine;
  const prev = engine, next = ENGINES[kind]();
  Object.keys(prev.books).forEach(sym => {
    const ob = prev.books[sym], nb = next.seed(sym, ob.last);
    nb.anchor = ob.anchor; nb.tape = ob.tape.slice();
    nb.vol = ob.vol; nb.trades = ob.trades; nb.buyVol = ob.buyVol; nb.sellVol = ob.sellVol;
  });
  prev.subs.forEach(cb => next.onTrade(cb));
  engine = next;
  return engine;
}
