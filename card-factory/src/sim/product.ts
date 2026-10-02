// Box / pack configuration: allocation of finite print runs to products,
// validation before manufacturing, and pull odds computed from the allocation.
import type { CardSet, GameState, HitCategory, Product, Variant } from './types';
import { CATEGORY_LABEL, hitCategory, variantPlayers } from './catalog';
import { fmtInt, fmtMoney } from './format';

export interface Issue {
  level: 'error' | 'warn' | 'info';
  msg: string;
  productId?: string;
  variantId?: string;
}

export interface CategoryPlan {
  category: HitCategory;
  copies: number;
  perBox: number;
  need: number;
}

export interface ProductPlan {
  slotsPerBox: number;
  slots: number;
  total: number;
  /** Copies in guaranteed categories, by category. */
  guaranteed: CategoryPlan[];
  /** Copies that are not in a guaranteed category. */
  filler: number;
  /** Of the filler, how many are unnumbered (and so may be trimmed as overrun). */
  trimmable: number;
  excess: number;
  shortage: number;
}

export function productVariants(set: CardSet, product: Product): Variant[] {
  return set.variants.filter((v) => (product.alloc[v.id] ?? 0) > 0);
}

export function productPlan(set: CardSet, product: Product): ProductPlan {
  const slotsPerBox = product.packsPerBox * product.cardsPerPack;
  const slots = slotsPerBox * product.boxes;
  const gCats = new Map(product.guarantees.filter((g) => g.perBox > 0).map((g) => [g.category, g.perBox]));
  const byCat = new Map<HitCategory, number>();
  let filler = 0;
  let trimmable = 0;
  let total = 0;
  for (const v of set.variants) {
    const copies = (product.alloc[v.id] ?? 0) * variantPlayers(set, v).length;
    if (!copies) continue;
    total += copies;
    const cat = hitCategory(v);
    if (cat && gCats.has(cat)) byCat.set(cat, (byCat.get(cat) ?? 0) + copies);
    else {
      filler += copies;
      if (!v.numbered && cat === null) trimmable += copies;
    }
  }
  const guaranteed: CategoryPlan[] = [...gCats.entries()].map(([category, perBox]) => ({
    category,
    perBox,
    copies: byCat.get(category) ?? 0,
    need: perBox * product.boxes,
  }));
  return {
    slotsPerBox,
    slots,
    total,
    guaranteed,
    filler,
    trimmable,
    excess: Math.max(0, total - slots),
    shortage: Math.max(0, slots - total),
  };
}

export function validateSet(state: GameState, set: CardSet): Issue[] {
  const issues: Issue[] = [];
  const products = state.products.filter((p) => p.setId === set.id);
  if (!set.name.trim()) issues.push({ level: 'error', msg: 'Give the set a name.' });
  if (set.checklist.length === 0) issues.push({ level: 'error', msg: 'The base checklist is empty. Add at least one player.' });
  if (set.status === 'draft' && set.releaseWeek <= state.week) {
    issues.push({ level: 'error', msg: `Release week ${set.releaseWeek} has passed. Pick week ${state.week + 1} or later.` });
  }
  const names = new Set<string>();
  for (const v of set.variants) {
    if (names.has(v.name.trim().toLowerCase())) issues.push({ level: 'error', msg: `Two versions are called "${v.name}". Rename one so collectors can tell them apart.`, variantId: v.id });
    names.add(v.name.trim().toLowerCase());
    const pids = variantPlayers(set, v);
    if (pids.length === 0) issues.push({ level: 'error', msg: `${v.name} has no players. Pick who receives it or delete it.`, variantId: v.id });
    if (!Number.isInteger(v.printRun) || v.printRun < 1) issues.push({ level: 'error', msg: `${v.name}: copies per card must be a whole number of at least 1.`, variantId: v.id });
    if (v.numbered && v.printRun > 9999) issues.push({ level: 'error', msg: `${v.name}: serial numbering goes up to /9999.`, variantId: v.id });
    const retired = pids.filter((id) => state.players[id]?.status === 'retired');
    if (retired.length && v.autographed) issues.push({ level: 'info', msg: `${v.name}: ${retired.length} retired player(s) will still sign; they cost the same.`, variantId: v.id });
    // Allocation across products.
    const allocated = products.reduce((s, p) => s + (p.alloc[v.id] ?? 0), 0);
    if (allocated > v.printRun) {
      const parts = products.filter((p) => p.alloc[v.id]).map((p) => `${p.name} ${p.alloc[v.id]}`).join(' + ');
      issues.push({
        level: 'error',
        msg: `${v.name}: ${parts} = ${allocated} copies of each card, but only ${v.printRun} ${v.numbered ? `exist (/${v.printRun})` : 'are printed'}. Lower an allocation or raise the print run.`,
        variantId: v.id,
      });
    } else if (allocated < v.printRun) {
      const left = (v.printRun - allocated) * pids.length;
      issues.push({ level: 'warn', msg: `${v.name}: ${v.printRun - allocated} of ${v.printRun} copies of each card are not packed into any box (${fmtInt(left)} cards). They are still printed and paid for, and stay in your vault.`, variantId: v.id });
    }
  }
  if (products.length === 0) issues.push({ level: 'error', msg: 'Create a box product for this set.' });
  for (const p of products) issues.push(...validateProduct(set, p));
  return issues;
}

export function validateProduct(set: CardSet, p: Product): Issue[] {
  const issues: Issue[] = [];
  const at = (level: Issue['level'], msg: string) => issues.push({ level, msg: `${p.name}: ${msg}`, productId: p.id });
  if (!p.name.trim()) at('error', 'name the product.');
  if (!(p.boxes >= 1 && Number.isInteger(p.boxes))) at('error', 'produce at least one box.');
  if (!(p.packsPerBox >= 1 && p.packsPerBox <= 48)) at('error', 'packs per box must be between 1 and 48.');
  if (!(p.cardsPerPack >= 1 && p.cardsPerPack <= 30)) at('error', 'cards per pack must be between 1 and 30.');
  if (!(p.price > 0)) at('error', 'set a box price above $0.');
  if (issues.length) return issues;
  const plan = productPlan(set, p);
  const gSum = plan.guaranteed.reduce((s, g) => s + g.perBox, 0);
  if (gSum > plan.slotsPerBox) at('error', `guarantees add up to ${gSum} cards per box, but a box only holds ${plan.slotsPerBox}.`);
  for (const g of plan.guaranteed) {
    if (g.copies < g.need) {
      at('error', `guaranteeing ${g.perBox} ${CATEGORY_LABEL[g.category].toLowerCase()} per box × ${fmtInt(p.boxes)} boxes needs ${fmtInt(g.need)}, but only ${fmtInt(g.copies)} are allocated. Allocate more, lower the guarantee, or make fewer boxes (at most ${fmtInt(Math.floor(g.copies / g.perBox))}).`);
    } else if (g.copies > g.need) {
      at('info', `${fmtInt(g.copies - g.need)} ${CATEGORY_LABEL[g.category].toLowerCase()} beyond the guarantee will land as bonus hits in random boxes.`);
    }
  }
  if (plan.shortage > 0) {
    at('error', `${fmtInt(p.boxes)} boxes × ${plan.slotsPerBox} cards need ${fmtInt(plan.slots)} cards, but only ${fmtInt(plan.total)} are allocated (short ${fmtInt(plan.shortage)}). Add base copies or make about ${fmtInt(Math.floor(plan.total / plan.slotsPerBox))} boxes.`);
  } else if (plan.excess > 0) {
    if (plan.excess > plan.trimmable) {
      at('error', `${fmtInt(plan.excess)} allocated cards don't fit in the boxes, and only ${fmtInt(plan.trimmable)} of them are unnumbered base cards that could be left out. Numbered and hit cards can't be dropped: add boxes or allocate fewer special cards.`);
    } else {
      at('warn', `${fmtInt(plan.excess)} base cards don't fit in ${fmtInt(p.boxes)} boxes. They'll be printed but stay in the warehouse as overrun (about ${Math.ceil(plan.excess / plan.slotsPerBox)} more boxes would use them).`);
    }
  }
  const special = plan.total - plan.trimmable;
  if (plan.slots > 0 && special > plan.slots * 0.5) at('warn', 'more than half of every box is special cards. Collectors may see the hits as cheap.');
  if (p.price > 0 && p.price < plan.slotsPerBox * 0.05) at('warn', `${fmtMoney(p.price)} is less than packaging and printing for a box this size.`);
  return issues;
}

export interface OddsRow {
  variant: Variant;
  copies: number;
  perBox: number;
  packOdds: number | null;
  boxOdds: number | null;
  guaranteed: number;
}

/** Odds computed from the actual allocation (after any base overrun is trimmed). */
export function productOdds(set: CardSet, p: Product): OddsRow[] {
  const plan = productPlan(set, p);
  const packs = p.boxes * p.packsPerBox;
  const rows: OddsRow[] = [];
  for (const v of set.variants) {
    let copies = (p.alloc[v.id] ?? 0) * variantPlayers(set, v).length;
    if (!copies) continue;
    if (!v.numbered && hitCategory(v) === null && plan.excess > 0 && plan.trimmable > 0) {
      copies -= Math.round(plan.excess * (copies / plan.trimmable));
    }
    const cat = hitCategory(v);
    const g = p.guarantees.find((x) => x.category === cat)?.perBox ?? 0;
    rows.push({
      variant: v,
      copies,
      perBox: copies / p.boxes,
      packOdds: copies ? packs / copies : null,
      boxOdds: copies ? p.boxes / copies : null,
      guaranteed: g,
    });
  }
  return rows;
}

export function hasErrors(issues: Issue[]) {
  return issues.some((i) => i.level === 'error');
}
