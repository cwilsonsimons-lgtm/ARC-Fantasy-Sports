// Collector economy: what a card is worth to collectors, how often it trades,
// what an unopened box is expected to hold, and how many boxes sell each week.
import type { CardMarket, CardSet, GameState, Player, Product, Sale, Variant } from './types';
import { parseCardId, variantPlayers } from './catalog';
import { POS_APPEAL } from './league';
import type { Rng } from './rng';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** 0..~110: how much collectors want this player's cards right now. */
export function playerAppeal(p: Player, setYear: number) {
  const rookieCard = p.rookieYear === setYear;
  let a = 0.62 * p.popularity + 0.28 * p.form + 0.1 * p.skill;
  if (rookieCard) a += 6 + Math.max(0, p.potential - p.skill) * 0.4;
  if (p.status === 'injured') a -= p.injuryWeeks > 8 ? 8 : 3;
  if (p.status === 'retired') a = a * 0.85 + (p.skill > 85 ? 8 : 0);
  return clamp(a + POS_APPEAL[p.pos] * 0.25, 1, 115);
}

const THEME_APPEAL: Record<CardSet['theme'], number> = { classic: 1, chrome: 1.08, noir: 1.04, retro: 1.02 };
const FINISH_APPEAL: Record<Variant['finish'], number> = { paper: 1, chrome: 1.1, foil: 1.12, refractor: 1.25, wave: 1.2, mojo: 1.3 };

export function setSentiment(state: GameState, setId: string) {
  const ps = state.products.filter((p) => p.setId === setId && p.inv);
  if (!ps.length) return 60;
  return ps.reduce((s, p) => s + p.sentiment, 0) / ps.length;
}

/**
 * The model's demand value for one card: popularity drives it far more than
 * scarcity, so a superstar's common base card can outsell a low-numbered
 * parallel of a player nobody follows.
 */
export function fairValue(state: GameState, set: CardSet, v: Variant, p: Player): number {
  const a = playerAppeal(p, set.year);
  const fatigue = state.market.fatigue;
  // Scarcity premium, dampened when collectors are tired of "rare" parallels.
  const scarcityExp = 0.65 * (1 - 0.35 * fatigue);
  const scarcity = Math.pow(1000 / Math.max(1, v.printRun), scarcityExp);
  const star = Math.pow(a / 50, 4);
  let value = 0.1 * star * scarcity;
  value *= FINISH_APPEAL[v.finish] * THEME_APPEAL[set.theme];
  if (v.autographed) value *= 2 + a / 25;
  if (v.memorabilia) value *= 1.6;
  if (v.numbered && v.printRun === 1) value *= 1.8;
  const rep = state.company.reputation;
  value *= 0.7 + rep / 170;
  value *= 0.8 + setSentiment(state, set.id) / 300;
  // Collector floors: even unwanted cards have a minimum trading price.
  const floor = v.autographed ? 4 + 60 / Math.sqrt(v.printRun) : v.numbered ? 0.4 + 30 / v.printRun : 0.08;
  return Math.max(floor, value);
}

export function fairValueById(state: GameState, id: string) {
  const { setId, variantId, playerId } = parseCardId(id);
  const set = state.sets.find((s) => s.id === setId)!;
  const v = set.variants.find((x) => x.id === variantId)!;
  return fairValue(state, set, v, state.players[playerId]);
}

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export interface PriceEstimate {
  /** Median of recent completed sales, or null when there are none. */
  value: number | null;
  lo: number;
  hi: number;
  sales: number;
  confidence: Confidence;
  last?: Sale;
}

/** Market estimate from completed sales only — the model's hidden value is never shown as a price. */
export function estimate(m: CardMarket | undefined, week: number): PriceEstimate {
  if (!m || !m.sales.length) return { value: null, lo: 0, hi: 0, sales: 0, confidence: 'none' };
  const recent = m.sales.filter((s) => s.w > week - 10);
  const use = (recent.length ? recent : m.sales).slice(-12);
  const ps = use.map((s) => s.p).sort((a, b) => a - b);
  const med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
  const n = recent.length;
  const confidence: Confidence = n >= 8 ? 'high' : n >= 3 ? 'medium' : 'low';
  // With thin data, widen the band rather than pretending to know.
  const spread = confidence === 'high' ? 0 : confidence === 'medium' ? 0.15 : 0.45;
  const lo = Math.min(ps[0], med * (1 - spread));
  const hi = Math.max(ps[ps.length - 1], med * (1 + spread));
  return { value: med, lo, hi, sales: n, confidence, last: m.sales[m.sales.length - 1] };
}

/** Expected collector value of one unopened box, from what is actually left in the pool. */
export function boxExpectedValue(state: GameState, product: Product): { ev: number; chase: { id: string; value: number }[] } {
  const inv = product.inv;
  if (!inv) return projectedBoxValue(state, product);
  const unopened = product.boxes - inv.opened;
  if (unopened <= 0) return { ev: 0, chase: [] };
  let total = 0;
  const chase: { id: string; value: number }[] = [];
  const add = (id: string, n: number) => {
    const fv = state.cards[id]?.fair || fairValueById(state, id);
    total += n * fv;
    chase.push({ id, value: fv });
  };
  for (const [id, n] of Object.entries(inv.pool)) add(id, n);
  for (const [id, s] of Object.entries(inv.serials)) add(id, s.length);
  chase.sort((a, b) => b.value - a.value);
  return { ev: total / unopened, chase: chase.slice(0, 5) };
}

/** Before manufacturing: EV from the planned allocation. */
export function projectedBoxValue(state: GameState, product: Product): { ev: number; chase: { id: string; value: number }[] } {
  const set = state.sets.find((s) => s.id === product.setId)!;
  let total = 0;
  const chase: { id: string; value: number }[] = [];
  for (const v of set.variants) {
    const n = product.alloc[v.id] ?? 0;
    if (!n) continue;
    for (const pid of variantPlayers(set, v)) {
      const fv = fairValue(state, set, v, state.players[pid]);
      total += n * fv;
      chase.push({ id: `${set.id}|${v.id}|${pid}`, value: fv });
    }
  }
  chase.sort((a, b) => b.value - a.value);
  return { ev: product.boxes ? total / product.boxes : 0, chase: chase.slice(0, 5) };
}

export interface SealedDemand {
  demand: number;
  ev: number;
  valueRatio: number;
  hype: number;
}

/** How many boxes collectors want this week. */
export function sealedDemand(state: GameState, product: Product, competing: number, rng: Rng | null): SealedDemand {
  const set = state.sets.find((s) => s.id === product.setId)!;
  const { ev, chase } = boxExpectedValue(state, product);
  const weeksOut = Math.max(0, state.week - set.releaseWeek);
  const hype = 1.5 * Math.pow(0.8, weeksOut) + 0.3;
  const valueRatio = ev / product.price;
  const topChase = chase[0] ? chase[0].value / product.price : 0;
  const attract =
    Math.exp(1.9 * (Math.min(valueRatio, 1.6) - 0.75)) *
    (0.85 + 0.12 * Math.min(topChase, 3)) *
    (0.45 + product.sentiment / 110) *
    (0.55 + state.company.reputation / 110) *
    (1 - 0.45 * state.market.fatigue);
  const priceCount = Math.pow(100 / product.price, 0.4);
  const tierBase = product.tier === 'retail' ? 80 : product.tier === 'premium' ? 30 : 55;
  let demand = tierBase * hype * attract * priceCount / (1 + 0.35 * competing);
  if (rng) demand *= Math.exp(rng.normal(0, 0.18));
  return { demand: Math.max(0, demand), ev, valueRatio, hype };
}

/** Run one week of secondary-market trading for every pulled card. */
export function simulateSecondary(state: GameState, rng: Rng, freshPulls: Record<string, number>) {
  let count = 0;
  let value = 0;
  for (const [id, m] of Object.entries(state.cards)) {
    const { setId, variantId, playerId } = parseCardId(id);
    const set = state.sets.find((s) => s.id === setId)!;
    const v = set.variants.find((x) => x.id === variantId)!;
    const p = state.players[playerId];
    const fair = fairValue(state, set, v, p);
    m.fair = fair;
    const appeal = playerAppeal(p, set.year);
    const fresh = freshPulls[id] ?? 0;
    // Most copies sit in binders; fresh pulls and popular players change hands more.
    const lambda = Math.min(30, (m.pulled - fresh) * (0.006 + 0.02 * (appeal / 100)) + fresh * (v.numbered || v.autographed ? 0.55 : 0.04));
    let n = rng.poisson(lambda);
    if (v.numbered) n = Math.min(n, m.pulled);
    for (let i = 0; i < n; i++) {
      const price = Math.max(0.05, Math.round(fair * Math.exp(rng.normal(0, 0.24)) * 100) / 100);
      const sale: Sale = { w: state.week, p: price };
      if (v.numbered && m.serials.length) sale.s = rng.pick(m.serials);
      m.sales.push(sale);
      count++;
      value += price;
    }
    if (m.sales.length > 24) m.sales.splice(0, m.sales.length - 24);
    const est = estimate(m, state.week);
    m.hist.push({ w: state.week, est: est.value === null ? null : Math.round(est.value * 100) / 100, fair: Math.round(fair * 100) / 100, vol: n });
    if (m.hist.length > 78) m.hist.shift();
  }
  return { count, value };
}
