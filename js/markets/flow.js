// Arc Markets — the other side of the market.
//
// The spec's rule is that events never move a price directly; they change how
// participants behave, and the resulting order flow sets the price. With one
// real user, that rule only means something if there *are* other participants,
// so this module is them: a population of simulated traders who read the event
// feed and the projection (intrinsic value), form an opinion, and submit orders
// through the same engine the user trades on.
//
// Consequently there is no code path anywhere that assigns a price. Every
// number on every screen is the last print of a trade somebody chose to make.
import { getEngine, MIN_QTY, roundQty } from './engine.js';
import { DEFAULT_TERM, TERMS, intrinsic, symbolFor, termsFor, tradableUniverse } from './contracts.js';
import { consume, pending } from './events.js';
import { projectionFor } from './projections.js';
import { sweepResting } from './ledger.js';

// Participant archetypes. The mix matters: value traders pull price back toward
// the projection, momentum traders push it away, and noise keeps it from ever
// settling exactly on intrinsic value.
const TRADERS = [
  { kind: 'value',    weight: 0.42, aggression: 0.55 },
  { kind: 'momentum', weight: 0.33, aggression: 0.85 },
  { kind: 'noise',    weight: 0.25, aggression: 0.35 },
];

let listed = false;
let timer = null;
let tickMs = 3000;
const subs = [];

/** Repaint hooks — fired after a round of flow so views can re-read prices. */
export function onFlow(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i > -1) subs.splice(i, 1); }; }

// ---------------------------------------------------------------- listing
/**
 * Open every contract with a genuine opening auction rather than a set price:
 * the book is seeded at intrinsic value and then traded into its starting
 * price by participants, so even the first quote is the product of order flow.
 */
export function listMarket() {
  if (listed) return;
  listed = true;
  const eng = getEngine();
  tradableUniverse().forEach(p => {
    termsFor(p.id).forEach(t => {
      const sym = symbolFor(p.id, t.key);
      const iv = intrinsic(p, t.key).value;
      eng.seed(sym, Math.max(0.05, iv));
      // opening auction: a handful of trades around fair value
      const n = 2 + Math.floor(rand(p.id + t.key) * 4);
      for (let i = 0; i < n; i++) {
        const side = rand(p.id + t.key + i) > 0.46 ? 'buy' : 'sell';
        eng.submit({ sym, side, qty: roundQty(1 + rand(p.id + i + 'q') * 12), type: 'market', who: 'mm' });
      }
    });
  });
}

let rs = 1;
function rand(key) {
  let h = 2166136261;
  const s = String(key) + (rs++);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), h | 1);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- reactions
// An event does not become a price. It becomes a queue of orders, each from a
// participant who read it differently, and the market resolves them.
function reactTo(ev) {
  const eng = getEngine();
  const terms = termsFor(ev.playerId);
  if (!terms.length) return;
  // how many participants noticed, scaled by how big the news is
  const crowd = 2 + Math.floor(Math.abs(ev.sentiment) * 6 + rand(ev.id) * 3);
  for (let i = 0; i < crowd; i++) {
    const t = pickTrader(rand(ev.id + i));
    // longer contracts react less to a single game, more to career news
    const term = terms[Math.floor(rand(ev.id + 'tm' + i) * terms.length)];
    const horizon = ev.tier === 3 ? (term.years === 1 ? 1 : 0.35) : term.years >= 3 ? 1.15 : 1;
    const conviction = ev.sentiment * horizon * (0.5 + rand(ev.id + 'c' + i));
    // a value trader fades news the crowd overreacts to
    const dir = t.kind === 'value' && Math.abs(conviction) > 1.2 ? -Math.sign(conviction)
              : Math.sign(conviction) || (rand(ev.id + 'd' + i) > 0.5 ? 1 : -1);
    const qty = roundQty((0.4 + rand(ev.id + 'q' + i) * 9) * t.aggression * (1 + Math.abs(conviction)));
    if (qty < MIN_QTY) continue;
    eng.submit({ sym: symbolFor(ev.playerId, term.key), side: dir > 0 ? 'buy' : 'sell',
                 qty, type: 'market', who: t.kind });
  }
}
function pickTrader(r) {
  let acc = 0;
  for (const t of TRADERS) { acc += t.weight; if (r <= acc) return t; }
  return TRADERS[TRADERS.length - 1];
}

// ---------------------------------------------------------------- background
// Ambient two-way flow, so a market with no news still trades — and so value
// traders can pull a price that has run too far back toward the projection.
// This is arbitrage behaviour, not a correction applied to the price.
function ambient() {
  const eng = getEngine();
  const pool = tradableUniverse();
  const n = 6 + Math.floor(rand('amb') * 8);
  for (let i = 0; i < n; i++) {
    const p = pool[Math.floor(rand('p' + i) * pool.length)];
    const terms = termsFor(p.id);
    const term = terms[Math.floor(rand('t' + i) * terms.length)];
    const sym = symbolFor(p.id, term.key);
    const q = eng.quote(sym);
    if (!q) continue;
    const iv = intrinsic({ ...p, sproj: projectionFor(p.id) }, term.key).value;
    const px = q.last != null ? q.last : q.mid;
    const gap = iv ? (iv - px) / iv : 0;              // + = trading below fair value
    const t = pickTrader(rand('k' + i));
    // value traders lean toward the gap, momentum traders with the last move,
    // noise traders neither way
    let bias = 0;
    if (t.kind === 'value') bias = Math.max(-0.9, Math.min(0.9, gap * 2.2));
    else if (t.kind === 'momentum') bias = lastMove(eng, sym) * 0.55;
    const roll = rand('r' + i) * 2 - 1;
    const side = (roll + bias) >= 0 ? 'buy' : 'sell';
    const qty = roundQty((0.3 + rand('q' + i) * 6) * t.aggression);
    if (qty >= MIN_QTY) eng.submit({ sym, side, qty, type: 'market', who: t.kind });
  }
}
function lastMove(eng, sym) {
  const tape = eng.tape(sym);
  if (tape.length < 2) return 0;
  const a = tape[tape.length - 2].px, b = tape[tape.length - 1].px;
  return a ? Math.max(-1, Math.min(1, (b - a) / a * 30)) : 0;
}

// ---------------------------------------------------------------- clock
// The market never closes: this runs whenever the app is open, weekday or
// weekend, in-season or out.
export function tick() {
  pending().forEach(ev => { reactTo(ev); consume(ev); });
  ambient();
  sweepResting();                      // resting limits get their chance to fill
  subs.forEach(cb => { try { cb(); } catch (e) {} });
}

export function startFlow(ms) {
  listMarket();
  if (ms) tickMs = ms;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, tickMs);
  return timer;
}
export function stopFlow() { if (timer) clearInterval(timer); timer = null; }
export function isRunning() { return !!timer; }
