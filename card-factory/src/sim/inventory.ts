// Finite inventory. Manufacturing turns print runs into exact per-product pools
// (with every serial number assigned once); opening boxes draws from those pools
// without replacement, so a /10 card can never be pulled an eleventh time.
//
// Collation is resolved when a box is opened rather than stored box-by-box at
// the factory. Sealed boxes of one product are interchangeable until opened, so
// drawing a box's contents from the remaining pool is the same lottery as
// collating every box up front — and it keeps saves small. Guarantees are
// enforced by reserving, for every still-sealed box, its guaranteed hits.
import type { CardSet, GameState, HitCategory, Product, ProductInventory } from './types';
import { cardId, hitCategory, packagingCost, productionSummary, unitCost, variantPlayers } from './catalog';
import { hasErrors, productPlan, validateSet } from './product';
import { multiHypergeometric, type Rng } from './rng';

export class GameError extends Error {}

export function manufactureSet(state: GameState, setId: string, rng: Rng) {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) throw new GameError('No such set.');
  if (set.status !== 'draft') throw new GameError(`${set.name} is already manufactured; its checklist and print runs are locked.`);
  const issues = validateSet(state, set);
  if (hasErrors(issues)) throw new GameError(issues.find((i) => i.level === 'error')!.msg);
  const summary = productionSummary(state, set);
  if (summary.totalCost > state.company.cash) {
    throw new GameError(`Manufacturing costs ${Math.round(summary.totalCost).toLocaleString()} but you have ${Math.round(state.company.cash).toLocaleString()} in cash.`);
  }
  const products = state.products.filter((p) => p.setId === setId);
  for (const p of products) {
    p.inv = { warehouse: p.boxes, collectorSealed: 0, opened: 0, sold: 0, pool: {}, serials: {}, cost: p.boxes * packagingCost(p.packsPerBox) };
  }
  set.leftover = {};
  set.leftoverSerials = {};

  for (const v of set.variants) {
    for (const pid of variantPlayers(set, v)) {
      const id = cardId(set.id, v.id, pid);
      const each = unitCost(v, state.players[pid]);
      if (v.numbered) {
        const serials = rng.shuffle(Array.from({ length: v.printRun }, (_, i) => i + 1));
        let at = 0;
        for (const p of products) {
          const n = p.alloc[v.id] ?? 0;
          if (n > 0) {
            p.inv!.serials[id] = serials.slice(at, at + n).sort((a, b) => a - b);
            p.inv!.cost += n * each;
            at += n;
          }
        }
        if (at < serials.length) set.leftoverSerials[id] = serials.slice(at).sort((a, b) => a - b);
      } else {
        let used = 0;
        for (const p of products) {
          const n = p.alloc[v.id] ?? 0;
          if (n > 0) {
            p.inv!.pool[id] = n;
            p.inv!.cost += n * each;
            used += n;
          }
        }
        if (used < v.printRun) set.leftover[id] = v.printRun - used;
      }
    }
  }

  // Trim base overrun that doesn't fit into the boxes.
  for (const p of products) {
    const plan = productPlan(set, p);
    if (plan.excess > 0) trimOverrun(set, p, plan.excess);
  }

  set.status = 'manufactured';
  set.manufacturedWeek = state.week;
  state.ledger.push({ w: state.week, kind: 'design', amount: -summary.designCost, memo: `Design & licensing — ${set.name}`, ref: set.id });
  state.ledger.push({ w: state.week, kind: 'manufacturing', amount: -(summary.printCost + summary.packagingCost), memo: `Printing & packaging — ${set.name}`, ref: set.id });
  state.company.cash -= summary.totalCost;
  return summary;
}

function trimOverrun(set: CardSet, p: Product, excess: number) {
  const inv = p.inv!;
  const ids = Object.keys(inv.pool).filter((id) => {
    const v = set.variants.find((x) => x.id === id.split('|')[1])!;
    return !v.numbered && hitCategory(v) === null;
  });
  const total = ids.reduce((s, id) => s + inv.pool[id], 0);
  const cut: Record<string, number> = {};
  let assigned = 0;
  for (const id of ids) {
    cut[id] = Math.floor((excess * inv.pool[id]) / total);
    assigned += cut[id];
  }
  const order = [...ids].sort((a, b) => inv.pool[b] - cut[b] - (inv.pool[a] - cut[a]) || (a < b ? -1 : 1));
  for (let i = 0; assigned < excess; i = (i + 1) % order.length) {
    const id = order[i];
    if (inv.pool[id] - cut[id] > 0) {
      cut[id]++;
      assigned++;
    }
  }
  for (const id of ids) {
    if (!cut[id]) continue;
    inv.pool[id] -= cut[id];
    set.leftover[id] = (set.leftover[id] ?? 0) + cut[id];
    if (inv.pool[id] === 0) delete inv.pool[id];
  }
}

export function unopenedBoxes(p: Product) {
  return p.inv ? p.boxes - p.inv.opened : 0;
}

export interface Pull {
  cardId: string;
  serial?: number;
}

function poolCount(inv: ProductInventory, id: string) {
  return inv.serials[id] ? inv.serials[id].length : inv.pool[id] ?? 0;
}

function takeCopies(inv: ProductInventory, id: string, n: number, rng: Rng, out: Pull[]) {
  if (n <= 0) return;
  const serials = inv.serials[id];
  if (serials) {
    if (serials.length < n) throw new Error(`Inventory underflow on ${id}`);
    for (let i = 0; i < n; i++) {
      const j = rng.int(0, serials.length - 1);
      const s = serials[j];
      serials[j] = serials[serials.length - 1];
      serials.pop();
      out.push({ cardId: id, serial: s });
    }
    if (!serials.length) delete inv.serials[id];
  } else {
    const have = inv.pool[id] ?? 0;
    if (have < n) throw new Error(`Inventory underflow on ${id}`);
    inv.pool[id] = have - n;
    if (!inv.pool[id]) delete inv.pool[id];
    for (let i = 0; i < n; i++) out.push({ cardId: id });
  }
}

/**
 * Open k sealed boxes of a product, drawing from its finite pool.
 * Does not touch who owned the boxes; the caller adjusts warehouse / collectorSealed.
 * Returns the pulls, grouped per box when k is small enough to need it (`boxes`).
 */
export function openBoxes(state: GameState, product: Product, k: number, rng: Rng): { pulls: Pull[]; boxes?: Pull[][] } {
  const inv = product.inv;
  if (!inv) throw new GameError('This product has not been manufactured.');
  const set = state.sets.find((s) => s.id === product.setId)!;
  const r = product.boxes - inv.opened;
  if (k <= 0) return { pulls: [] };
  if (k > r) throw new GameError(`Only ${r} unopened boxes remain.`);
  const perBox = k <= 3;
  if (perBox && k > 1) {
    const boxes: Pull[][] = [];
    for (let i = 0; i < k; i++) boxes.push(openBoxes(state, product, 1, rng).pulls);
    return { pulls: boxes.flat(), boxes };
  }

  const slotsPerBox = product.packsPerBox * product.cardsPerPack;
  const catOf = new Map(set.variants.map((v) => [v.id, hitCategory(v)]));
  const guarantees = product.guarantees.filter((g) => g.perBox > 0);
  const gCats = new Set<HitCategory>(guarantees.map((g) => g.category));
  const ids = [...Object.keys(inv.pool), ...Object.keys(inv.serials)].sort();
  const byCat = new Map<HitCategory, string[]>();
  const filler: string[] = [];
  for (const id of ids) {
    const c = catOf.get(id.split('|')[1]) ?? null;
    if (c && gCats.has(c)) {
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(id);
    } else filler.push(id);
  }

  const pulls: Pull[] = [];
  const drawFrom = (list: string[], m: number) => {
    if (m <= 0) return;
    const counts = list.map((id) => poolCount(inv, id));
    const got = multiHypergeometric(rng, counts, m);
    list.forEach((id, i) => takeCopies(inv, id, got[i], rng, pulls));
  };

  // 1. Guaranteed hits for each box being opened.
  for (const g of guarantees) drawFrom(byCat.get(g.category) ?? [], g.perBox * k);
  // 2. Remaining slots come from filler plus each category's surplus beyond what the other sealed boxes are owed.
  const surplus = guarantees.map((g) => {
    const left = (byCat.get(g.category) ?? []).reduce((s, id) => s + poolCount(inv, id), 0);
    return left - g.perBox * (r - k);
  });
  const restSlots = k * (slotsPerBox - guarantees.reduce((s, g) => s + g.perBox, 0));
  const fillerCounts = filler.map((id) => poolCount(inv, id));
  const got = multiHypergeometric(rng, [...fillerCounts, ...surplus], restSlots);
  filler.forEach((id, i) => takeCopies(inv, id, got[i], rng, pulls));
  guarantees.forEach((g, i) => drawFrom(byCat.get(g.category) ?? [], got[filler.length + i]));

  if (pulls.length !== k * slotsPerBox) throw new Error(`Collation error: ${pulls.length} cards for ${k} boxes of ${slotsPerBox}`);
  inv.opened += k;

  for (const p of pulls) {
    let m = state.cards[p.cardId];
    if (!m) m = state.cards[p.cardId] = { pulled: 0, serials: [], sales: [], hist: [], fair: 0, firstPulledWeek: state.week };
    m.pulled++;
    if (p.serial !== undefined) m.serials.push(p.serial);
  }
  return { pulls, boxes: perBox ? [pulls] : undefined };
}

/** Split one box's pulls into packs, shuffled, for display. */
export function intoPacks(product: Product, pulls: Pull[], rng: Rng): Pull[][] {
  const xs = rng.shuffle([...pulls]);
  const packs: Pull[][] = [];
  for (let i = 0; i < product.packsPerBox; i++) packs.push(xs.slice(i * product.cardsPerPack, (i + 1) * product.cardsPerPack));
  return packs;
}

/** Copies of a card: printed, still sealed in any product, sitting in the vault, and pulled. */
export function cardSupply(state: GameState, id: string) {
  const [setId, variantId] = id.split('|');
  const set = state.sets.find((s) => s.id === setId);
  const v = set?.variants.find((x) => x.id === variantId);
  let sealed = 0;
  for (const p of state.products) if (p.setId === setId && p.inv) sealed += poolCount(p.inv, id);
  const vault = set ? (set.leftoverSerials[id]?.length ?? set.leftover[id] ?? 0) : 0;
  const pulled = state.cards[id]?.pulled ?? 0;
  return { printed: v?.printRun ?? 0, sealed, vault, pulled };
}
