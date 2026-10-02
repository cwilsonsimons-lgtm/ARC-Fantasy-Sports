// Turning a set definition into concrete cards, and what printing them costs.
import type { CardSet, Finish, GameState, HitCategory, Player, Variant } from './types';

export interface Card {
  id: string;
  setId: string;
  variantId: string;
  playerId: string;
  /** Number on the back, from the base checklist; inserts / non-checklist players continue after it. */
  number: number;
  printRun: number;
  numbered: boolean;
}

export const cardId = (setId: string, variantId: string, playerId: string) => `${setId}|${variantId}|${playerId}`;

export function parseCardId(id: string) {
  const [setId, variantId, playerId] = id.split('|');
  return { setId, variantId, playerId };
}

export function cardNumber(set: CardSet, playerId: string) {
  const i = set.checklist.indexOf(playerId);
  return i >= 0 ? i + 1 : set.checklist.length + 1 + (Math.abs(hashId(playerId)) % 50);
}
function hashId(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

export function variantPlayers(set: CardSet, v: Variant): string[] {
  return v.kind === 'base' ? set.checklist : v.playerIds;
}

export function setCards(set: CardSet): Card[] {
  const out: Card[] = [];
  for (const v of set.variants) {
    for (const pid of variantPlayers(set, v)) {
      out.push({ id: cardId(set.id, v.id, pid), setId: set.id, variantId: v.id, playerId: pid, number: cardNumber(set, pid), printRun: v.printRun, numbered: v.numbered });
    }
  }
  return out;
}

/** Which guarantee bucket a card version belongs to. `null` = ordinary filler. */
export function hitCategory(v: Variant): HitCategory | null {
  if (v.autographed) return 'auto';
  if (v.memorabilia) return 'relic';
  if (v.numbered) return 'numbered';
  if (v.kind === 'insert') return 'insert';
  return null;
}

export const CATEGORY_LABEL: Record<HitCategory, string> = {
  auto: 'Autographs',
  relic: 'Memorabilia',
  numbered: 'Numbered parallels',
  insert: 'Inserts',
};

export const FINISH_COST: Record<Finish, number> = { paper: 0.03, chrome: 0.06, foil: 0.08, refractor: 0.1, wave: 0.12, mojo: 0.14 };
export const FINISH_LABEL: Record<Finish, string> = { paper: 'Paper', chrome: 'Chrome', foil: 'Foil', refractor: 'Refractor', wave: 'Wave', mojo: 'Mojo' };
export const SERIAL_STAMP_COST = 0.12;
export const RELIC_COST = 3;
export const SET_DESIGN_BASE = 4000;
export const SET_DESIGN_PER_VARIANT = 250;

/** One player's fee to sign one card. Stars are expensive. */
export function signingFee(p: Player) {
  return Math.round((3 + Math.pow(Math.max(1, p.popularity), 1.5) / 15) * 100) / 100;
}

export function unitCost(v: Variant, p: Player | undefined) {
  let c = FINISH_COST[v.finish];
  if (v.numbered) c += SERIAL_STAMP_COST;
  if (v.memorabilia) c += RELIC_COST;
  if (v.autographed && p) c += signingFee(p);
  return c;
}

export function packagingCost(packsPerBox: number) {
  return 1.25 + 0.15 * packsPerBox;
}

export interface VariantSummary {
  variant: Variant;
  uniqueCards: number;
  copiesEach: number;
  totalCopies: number;
  cost: number;
}

export interface ProductionSummary {
  variants: VariantSummary[];
  uniqueCards: number;
  totalCopies: number;
  printCost: number;
  designCost: number;
  packagingCost: number;
  totalCost: number;
  boxes: number;
  packs: number;
  boxSlots: number;
  projectedRevenue: number;
}

export function productionSummary(state: GameState, set: CardSet): ProductionSummary {
  const variants = set.variants.map((v) => {
    const pids = variantPlayers(set, v);
    let cost = 0;
    for (const pid of pids) cost += unitCost(v, state.players[pid]) * v.printRun;
    return { variant: v, uniqueCards: pids.length, copiesEach: v.printRun, totalCopies: pids.length * v.printRun, cost };
  });
  const products = state.products.filter((p) => p.setId === set.id);
  const pack = products.reduce((s, p) => s + p.boxes * packagingCost(p.packsPerBox), 0);
  const printCost = variants.reduce((s, v) => s + v.cost, 0);
  const designCost = SET_DESIGN_BASE + SET_DESIGN_PER_VARIANT * set.variants.length;
  return {
    variants,
    uniqueCards: variants.reduce((s, v) => s + v.uniqueCards, 0),
    totalCopies: variants.reduce((s, v) => s + v.totalCopies, 0),
    printCost,
    designCost,
    packagingCost: pack,
    totalCost: printCost + designCost + pack,
    boxes: products.reduce((s, p) => s + p.boxes, 0),
    packs: products.reduce((s, p) => s + p.boxes * p.packsPerBox, 0),
    boxSlots: products.reduce((s, p) => s + p.boxes * p.packsPerBox * p.cardsPerPack, 0),
    projectedRevenue: products.reduce((s, p) => s + p.boxes * p.price, 0),
  };
}
