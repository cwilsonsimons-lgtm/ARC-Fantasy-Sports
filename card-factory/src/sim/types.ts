// The whole game is one plain JSON-serialisable object. Stage-2..4 systems
// (multiple products, collector segments, competitors) slot into the fields
// marked below without changing the shape of what Stage 1 writes.

export type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'DL' | 'LB' | 'CB' | 'S' | 'K';

export interface Team {
  id: string;
  city: string;
  name: string;
  abbr: string;
  primary: string;
  secondary: string;
  /** 0..1, how big the fan base is. */
  market: number;
}

export type PlayerStatus = 'active' | 'injured' | 'retired';

export interface Player {
  id: string;
  first: string;
  last: string;
  teamId: string;
  pos: Pos;
  jersey: number;
  age: number;
  rookieYear: number;
  /** True talent, 0..100. */
  skill: number;
  potential: number;
  /** Recent on-field performance, 0..100 (exponential average of weekly games). */
  form: number;
  /** How much fans care, 0..100. */
  popularity: number;
  status: PlayerStatus;
  injuryWeeks: number;
  slumpWeeks: number;
  season: { games: number; yards: number; tds: number };
  /** Weekly snapshots, newest last, capped. */
  hist: { w: number; pop: number; form: number }[];
}

export type Finish = 'paper' | 'chrome' | 'foil' | 'refractor' | 'wave' | 'mojo';
export type VariantKind = 'base' | 'parallel' | 'insert' | 'auto' | 'relic';
export type ThemeId = 'classic' | 'chrome' | 'noir' | 'retro';

export interface Variant {
  id: string;
  name: string;
  kind: VariantKind;
  /** Accent colour of the parallel / frame. */
  color: string;
  finish: Finish;
  /** Players who receive this version. For the base variant this mirrors the set checklist. */
  playerIds: string[];
  /** Copies printed of EACH card in this variant. For numbered variants this is the /N. */
  printRun: number;
  numbered: boolean;
  autographed: boolean;
  memorabilia: boolean;
}

export interface CardSet {
  id: string;
  name: string;
  year: number;
  theme: ThemeId;
  releaseWeek: number;
  /** Base checklist in card-number order. */
  checklist: string[];
  /** variants[0] is always the base version. */
  variants: Variant[];
  status: 'draft' | 'manufactured' | 'released';
  createdWeek: number;
  manufacturedWeek?: number;
  /** Printed copies that were not packed into any product (unallocated or trimmed overrun). */
  leftover: Record<string, number>;
  leftoverSerials: Record<string, number[]>;
}

export type HitCategory = 'auto' | 'relic' | 'numbered' | 'insert';

export interface Guarantee {
  category: HitCategory;
  perBox: number;
}

export interface ProductInventory {
  /** Sealed boxes still owned by the company. */
  warehouse: number;
  /** Boxes sold to collectors and still sealed. */
  collectorSealed: number;
  /** Boxes opened by anyone. Unopened boxes = boxes - opened. */
  opened: number;
  sold: number;
  /** Unopened copies of each unnumbered card, across every unopened box of this product. */
  pool: Record<string, number>;
  /** Unopened serial numbers of each numbered card. */
  serials: Record<string, number[]>;
  cost: number;
}

export interface ProductWeek {
  w: number;
  sold: number;
  opened: number;
  ev: number;
  demand: number;
}

export interface Product {
  id: string;
  setId: string;
  name: string;
  tier: 'retail' | 'hobby' | 'premium';
  packsPerBox: number;
  cardsPerPack: number;
  boxes: number;
  price: number;
  guarantees: Guarantee[];
  /** variantId -> copies of EACH card of that variant packed into this product. */
  alloc: Record<string, number>;
  inv?: ProductInventory;
  revenue: number;
  /** Collector mood about this box, 0..100. */
  sentiment: number;
  /** Average realised card value per opened box divided by box price. */
  valueRatio?: number;
  weeks: ProductWeek[];
  soldOutWeek?: number;
}

export interface Sale {
  w: number;
  p: number;
  /** Serial number for numbered cards. */
  s?: number;
}

export interface PricePoint {
  w: number;
  /** Market estimate from completed sales, or null when there were none to go on. */
  est: number | null;
  /** The model's underlying demand value (not shown as a price). */
  fair: number;
  vol: number;
}

export interface CardMarket {
  /** Copies pulled from packs so far. */
  pulled: number;
  /** Serial numbers pulled so far (numbered cards only). */
  serials: number[];
  /** Most recent completed sales, newest last, capped. */
  sales: Sale[];
  hist: PricePoint[];
  fair: number;
  firstPulledWeek: number;
}

export type LedgerKind = 'manufacturing' | 'design' | 'box-sales' | 'overhead' | 'storage';

export interface LedgerEntry {
  w: number;
  kind: LedgerKind;
  amount: number;
  memo: string;
  ref?: string;
}

export interface NewsItem {
  id: number;
  w: number;
  tone: 'good' | 'bad' | 'neutral';
  kind: string;
  title: string;
  body: string;
  playerId?: string;
  cardId?: string;
  productId?: string;
}

export interface WeekReport {
  w: number;
  revenue: number;
  expenses: number;
  boxesSold: number;
  boxesOpened: number;
  secondaryCount: number;
  secondaryValue: number;
  cash: number;
  reputation: number;
}

export interface GameState {
  version: number;
  seed: number;
  rngCounter: number;
  nextId: number;
  week: number;
  company: { name: string; cash: number; reputation: number };
  teams: Team[];
  players: Record<string, Player>;
  sets: CardSet[];
  products: Product[];
  cards: Record<string, CardMarket>;
  ledger: LedgerEntry[];
  news: NewsItem[];
  reports: WeekReport[];
  market: {
    /** Collector fatigue from too many releases / too many "rare" cards, 0..1. */
    fatigue: number;
    releases: { w: number; setId: string; numberedCopies: number }[];
  };
  /** Stage 4: rival manufacturers. */
  competitors: unknown[];
}
