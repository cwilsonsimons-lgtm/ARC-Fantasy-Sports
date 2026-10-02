// Game state lifecycle: new game, player actions, and the weekly advance.
// Every action takes a state and returns a new one (the input is never mutated),
// which keeps React updates simple and makes saves trivially consistent.
import type { CardSet, GameState, NewsItem, Product, Variant } from './types';
import { createLeague, playerName, seasonYear, simulateLeagueWeek, type LeagueEvent } from './league';
import { hashString, makeRng, type Rng } from './rng';
import { cardId, hitCategory, parseCardId } from './catalog';
import { GameError, intoPacks, manufactureSet, openBoxes, type Pull } from './inventory';
import { boxExpectedValue, fairValueById, sealedDemand, simulateSecondary } from './market';
import { fmtMoney } from './format';

export const SAVE_VERSION = 1;
export const STARTING_CASH = 100_000;
export const WEEKLY_OVERHEAD = 750;
export const STORAGE_PER_BOX = 0.04;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function rngFor(state: GameState, tag: string): Rng {
  state.rngCounter++;
  return makeRng(hashString(`${state.seed}:${tag}:${state.week}:${state.rngCounter}`));
}

const clone = <T>(x: T): T => structuredClone(x);

export function newGame(seed: number, companyName = 'Foil & Ink Card Co.'): GameState {
  const league = createLeague(seed);
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rngCounter: 0,
    nextId: league.nextId,
    week: 1,
    company: { name: companyName, cash: STARTING_CASH, reputation: 50 },
    teams: league.teams,
    players: league.players,
    sets: [],
    products: [],
    cards: {},
    ledger: [],
    news: [],
    reports: [],
    market: { fatigue: 0.1, releases: [] },
    competitors: [],
  };
  // A ready-to-edit first release so the first screen shows a working example.
  const s = createSet(state, 'Prime Gridiron');
  const set = s.sets[s.sets.length - 1];
  const ranked = Object.values(s.players).filter((p) => p.status === 'active').sort((a, b) => b.popularity - a.popularity);
  set.checklist = ranked.slice(0, 60).map((p) => p.id);
  set.variants[0].printRun = 500;
  set.variants.push(makeVariant(s, 'parallel', { name: 'Gold Foil', color: '#c9a227', finish: 'foil', numbered: true, printRun: 99, playerIds: ranked.slice(0, 30).map((p) => p.id) }));
  set.variants.push(makeVariant(s, 'auto', { name: 'Signature Ink', color: '#1d3557', finish: 'chrome', numbered: true, printRun: 25, playerIds: ranked.slice(0, 12).map((p) => p.id) }));
  const withProduct = createProduct(s, set.id);
  const prod = withProduct.products[withProduct.products.length - 1];
  prod.boxes = 415;
  prod.price = 150;
  prod.guarantees = [{ category: 'numbered', perBox: 2 }];
  for (const v of set.variants) prod.alloc[v.id] = v.printRun;
  addNews(withProduct, { tone: 'neutral', kind: 'welcome', title: `${companyName} opens for business`, body: 'A draft of your first release, Prime Gridiron, is waiting in the Set Creator. Review the checklist and the hobby box, manufacture it, then advance the week to its release.' });
  return withProduct;
}

export function addNews(state: GameState, n: Omit<NewsItem, 'id' | 'w'>) {
  state.news.push({ ...n, id: state.nextId++, w: state.week });
  if (state.news.length > 250) state.news.splice(0, state.news.length - 250);
}

export function makeVariant(state: GameState, kind: Variant['kind'], over: Partial<Variant> = {}): Variant {
  const defaults: Record<Variant['kind'], Partial<Variant>> = {
    base: { name: 'Base', color: '#e9ecef', finish: 'chrome', printRun: 400, numbered: false },
    parallel: { name: 'Parallel', color: '#c9a227', finish: 'foil', printRun: 99, numbered: true },
    insert: { name: 'Insert', color: '#2a9d8f', finish: 'chrome', printRun: 50, numbered: false },
    auto: { name: 'Autograph', color: '#1d3557', finish: 'chrome', printRun: 25, numbered: true, autographed: true },
    relic: { name: 'Jersey Relic', color: '#6d597a', finish: 'paper', printRun: 50, numbered: true, memorabilia: true },
  };
  return {
    id: `v${state.nextId++}`,
    kind,
    playerIds: [],
    autographed: kind === 'auto',
    memorabilia: kind === 'relic',
    ...(defaults[kind] as Partial<Variant>),
    ...over,
  } as Variant;
}

export function createSet(input: GameState, name = 'New Set'): GameState {
  const state = clone(input);
  const id = `s${state.nextId++}`;
  const releaseWeek = state.week + 4;
  const set: CardSet = {
    id,
    name,
    year: seasonYear(releaseWeek),
    theme: 'chrome',
    releaseWeek,
    checklist: [],
    variants: [],
    status: 'draft',
    createdWeek: state.week,
    leftover: {},
    leftoverSerials: {},
  };
  set.variants.push(makeVariant(state, 'base'));
  state.sets.push(set);
  return state;
}

function editableSet(state: GameState, setId: string) {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) throw new GameError('No such set.');
  if (set.status !== 'draft') throw new GameError(`${set.name} is manufactured. Its checklist, print runs and products are locked.`);
  return set;
}

export function updateSet(input: GameState, setId: string, fn: (set: CardSet, state: GameState) => void): GameState {
  const state = clone(input);
  const set = editableSet(state, setId);
  fn(set, state);
  set.year = seasonYear(set.releaseWeek);
  // Drop allocations for versions that no longer exist.
  for (const p of state.products.filter((x) => x.setId === setId)) {
    for (const vid of Object.keys(p.alloc)) if (!set.variants.some((v) => v.id === vid)) delete p.alloc[vid];
  }
  return state;
}

export function deleteSet(input: GameState, setId: string): GameState {
  const state = clone(input);
  editableSet(state, setId);
  state.sets = state.sets.filter((s) => s.id !== setId);
  state.products = state.products.filter((p) => p.setId !== setId);
  return state;
}

export function createProduct(input: GameState, setId: string, tier: Product['tier'] = 'hobby'): GameState {
  const state = clone(input);
  const set = editableSet(state, setId);
  const p: Product = {
    id: `pr${state.nextId++}`,
    setId,
    name: tier === 'hobby' ? 'Hobby Box' : tier === 'retail' ? 'Retail Box' : 'Premium Box',
    tier,
    packsPerBox: 10,
    cardsPerPack: 8,
    boxes: 300,
    price: tier === 'retail' ? 40 : tier === 'premium' ? 250 : 100,
    guarantees: [],
    alloc: {},
    revenue: 0,
    sentiment: 60,
    weeks: [],
  };
  if (!state.products.some((x) => x.setId === setId)) for (const v of set.variants) p.alloc[v.id] = v.printRun;
  state.products.push(p);
  return state;
}

export function updateProduct(input: GameState, productId: string, fn: (p: Product, set: CardSet) => void): GameState {
  const state = clone(input);
  const p = state.products.find((x) => x.id === productId);
  if (!p) throw new GameError('No such product.');
  const set = editableSet(state, p.setId);
  fn(p, set);
  return state;
}

export function manufacture(input: GameState, setId: string): GameState {
  const state = clone(input);
  const set = state.sets.find((s) => s.id === setId)!;
  const summary = manufactureSet(state, setId, rngFor(state, `mfg:${setId}`));
  addNews(state, {
    tone: 'neutral',
    kind: 'manufactured',
    title: `${set.name} goes to press`,
    body: `${summary.uniqueCards.toLocaleString()} unique cards, ${summary.totalCopies.toLocaleString()} printed copies and ${summary.boxes.toLocaleString()} boxes for ${fmtMoney(summary.totalCost)}. Release is set for week ${set.releaseWeek}; the checklist and print runs are now locked.`,
  });
  return state;
}

export function rescheduleRelease(input: GameState, setId: string, week: number): GameState {
  const state = clone(input);
  const set = state.sets.find((s) => s.id === setId)!;
  if (set.status === 'released') throw new GameError('Already released.');
  if (week <= state.week) throw new GameError(`Pick week ${state.week + 1} or later.`);
  set.releaseWeek = week;
  if (set.status === 'draft') set.year = seasonYear(week);
  return state;
}

export interface BoxBreak {
  productId: string;
  packs: Pull[][];
  value: number;
}

/** Open one sealed box from the company's own warehouse (a promotional break). */
export function breakWarehouseBox(input: GameState, productId: string): { state: GameState; result: BoxBreak } {
  const state = clone(input);
  const p = state.products.find((x) => x.id === productId)!;
  if (!p.inv || p.inv.warehouse < 1) throw new GameError('No sealed boxes left in your warehouse.');
  const rng = rngFor(state, `break:${productId}`);
  const { pulls } = openBoxes(state, p, 1, rng);
  p.inv.warehouse--;
  const value = pulls.reduce((s, x) => s + fairValueById(state, x.cardId), 0);
  const set = state.sets.find((s) => s.id === p.setId)!;
  if (set.status === 'released') p.sentiment = clamp(p.sentiment + 1, 0, 100);
  return { state, result: { productId, packs: intoPacks(p, pulls, rng), value } };
}

function isNotable(state: GameState, id: string, value: number, price: number) {
  const { setId, variantId, playerId } = parseCardId(id);
  const v = state.sets.find((s) => s.id === setId)!.variants.find((x) => x.id === variantId)!;
  if (v.numbered && v.printRun === 1) return true;
  if (v.autographed && state.players[playerId].popularity >= 88) return true;
  return value >= Math.max(120, price * 1.5);
}

export function describeCard(state: GameState, id: string, serial?: number) {
  const { setId, variantId, playerId } = parseCardId(id);
  const set = state.sets.find((s) => s.id === setId)!;
  const v = set.variants.find((x) => x.id === variantId)!;
  const p = state.players[playerId];
  const num = v.numbered ? (serial !== undefined ? ` ${serial}/${v.printRun}` : ` /${v.printRun}`) : '';
  return `${playerName(p)} ${set.year} ${set.name} ${v.kind === 'base' ? 'Base' : v.name}${num}`;
}

/** Advance the game one week. */
export function advanceWeek(input: GameState): GameState {
  const state = clone(input);
  state.week++;
  const w = state.week;
  const ledgerStart = state.ledger.length;
  const rng = rngFor(state, 'week');

  // 1. The league plays.
  const events = simulateLeagueWeek(state, rng);
  const prevFair: Record<string, number> = {};
  for (const [id, m] of Object.entries(state.cards)) prevFair[id] = m.fair;

  // 2. Scheduled releases go live.
  state.market.fatigue *= 0.94;
  for (const set of state.sets) {
    if (set.status !== 'manufactured' || set.releaseWeek !== w) continue;
    set.status = 'released';
    const numberedVariants = set.variants.filter((v) => v.numbered).length;
    const numberedCopies = set.variants.filter((v) => v.numbered).reduce((s, v) => s + v.printRun * v.playerIds.length, 0);
    const recent = state.market.releases.filter((r) => r.w > w - 8).length;
    state.market.releases.push({ w, setId: set.id, numberedCopies });
    state.market.fatigue = clamp(state.market.fatigue + 0.12 + 0.03 * numberedVariants + Math.min(0.15, numberedCopies / 40000), 0, 1);
    const prods = state.products.filter((p) => p.setId === set.id);
    addNews(state, { tone: 'good', kind: 'release', title: `${set.name} hits shelves`, body: `${prods.map((p) => `${p.name} at ${fmtMoney(p.price)}`).join(', ')}. Collectors are lining up for the first breaks.` });
    if (recent >= 2) {
      addNews(state, { tone: 'bad', kind: 'fatigue', title: 'Collectors grumble about release overload', body: `${recent + 1} releases in eight weeks. Wallets are stretched, and new products are getting less attention.` });
    } else if (numberedVariants >= 5) {
      addNews(state, { tone: 'bad', kind: 'fatigue', title: `"Another rainbow?" ${set.name} parallels draw eye-rolls`, body: `${numberedVariants} numbered parallels in one set. Collectors say "rare" is starting to feel common.` });
    }
  }

  // 3. Sealed-box sales and openings.
  let revenue = 0;
  let boxesSold = 0;
  let boxesOpened = 0;
  const fresh: Record<string, number> = {};
  const notable: { id: string; serial?: number; value: number; product: Product }[] = [];
  const live = state.products.filter((p) => p.inv && state.sets.find((s) => s.id === p.setId)!.status === 'released');
  for (const p of live) {
    const inv = p.inv!;
    const set = state.sets.find((s) => s.id === p.setId)!;
    const competing = live.filter((o) => o !== p && w - state.sets.find((s) => s.id === o.setId)!.releaseWeek < 6 && o.inv!.warehouse > 0).length;
    const d = sealedDemand(state, p, competing, rng);
    const sold = Math.min(inv.warehouse, Math.round(d.demand));
    inv.warehouse -= sold;
    inv.sold += sold;
    const income = sold * p.price;
    p.revenue += income;
    revenue += income;
    boxesSold += sold;
    if (income > 0) state.ledger.push({ w, kind: 'box-sales', amount: income, memo: `${sold} × ${p.name} (${set.name}) @ ${fmtMoney(p.price)}`, ref: p.id });
    if (sold > 0 && inv.warehouse === 0 && p.soldOutWeek === undefined) {
      p.soldOutWeek = w;
      addNews(state, { tone: 'good', kind: 'sold-out', productId: p.id, title: `${set.name} ${p.name} sells out`, body: `Every box is gone ${w - set.releaseWeek === 0 ? 'in release week' : `after ${w - set.releaseWeek} week${w - set.releaseWeek > 1 ? 's' : ''}`}.` });
    }
    // Box breakers rip right away; others hold boxes and open them over time.
    const openNow = Math.round(sold * 0.55);
    inv.collectorSealed += sold - openNow;
    const openHeld = Math.min(inv.collectorSealed, rng.poisson(inv.collectorSealed * 0.07));
    inv.collectorSealed -= openHeld;
    const k = openNow + openHeld;
    let realised = 0;
    if (k > 0) {
      const { pulls } = openBoxes(state, p, k, rng);
      for (const x of pulls) {
        fresh[x.cardId] = (fresh[x.cardId] ?? 0) + 1;
        const value = fairValueById(state, x.cardId);
        realised += value;
        if (isNotable(state, x.cardId, value, p.price)) notable.push({ id: x.cardId, serial: x.serial, value, product: p });
      }
      boxesOpened += k;
      const ratio = realised / k / p.price;
      p.valueRatio = p.valueRatio === undefined ? ratio : p.valueRatio * 0.6 + ratio * 0.4;
      const target = clamp(25 + 50 * Math.min(1.4, ratio / 0.8), 5, 95);
      p.sentiment = clamp(p.sentiment + (target - p.sentiment) * 0.35, 0, 100);
    }
    p.weeks.push({ w, sold, opened: k, ev: Math.round(d.ev * 100) / 100, demand: Math.round(d.demand) });
    if (p.weeks.length > 104) p.weeks.shift();

    const age = w - set.releaseWeek;
    if (age >= 2 && p.valueRatio !== undefined && p.valueRatio < 0.45 && !state.news.some((n) => n.kind === 'criticism' && n.productId === p.id)) {
      addNews(state, { tone: 'bad', kind: 'criticism', productId: p.id, title: `Collectors call ${set.name} ${p.name} a "${fmtMoney(p.price)} letdown"`, body: `Breakers say the average box returns about ${fmtMoney(p.valueRatio * p.price)} in card value. Sentiment is sliding.` });
    } else if (age >= 1 && p.valueRatio !== undefined && p.valueRatio > 1.05 && !state.news.some((n) => n.kind === 'praise' && n.productId === p.id)) {
      addNews(state, { tone: 'good', kind: 'praise', productId: p.id, title: `${set.name} ${p.name} earns rave reviews`, body: `Breakers are pulling more value than the ${fmtMoney(p.price)} sticker price. Demand is climbing.` });
    }
  }
  notable.sort((a, b) => b.value - a.value);
  for (const n of notable.slice(0, 2)) {
    const { playerId } = parseCardId(n.id);
    addNews(state, { tone: 'good', kind: 'pull', cardId: n.id, playerId, productId: n.product.id, title: `Pulled: ${describeCard(state, n.id, n.serial)}`, body: `A collector opened it from a ${n.product.name}. Similar cards are valued around ${fmtMoney(n.value)}.` });
    n.product.sentiment = clamp(n.product.sentiment + 1.5, 0, 100);
  }

  // 4. Secondary market (does not pay the manufacturer).
  const secondary = simulateSecondary(state, rng, fresh);

  // 5. League news, with the effect on cards you've already sold.
  reportLeague(state, events, prevFair);

  // 6. Reputation.
  let rep = state.company.reputation;
  for (const p of live) {
    const set = state.sets.find((s) => s.id === p.setId)!;
    if (w - set.releaseWeek <= 10 && p.inv!.opened > 0) rep += (p.sentiment - 55) * 0.025;
  }
  if (state.market.fatigue > 0.6) rep -= 0.25;
  rep += (50 - rep) * 0.01;
  state.company.reputation = clamp(rep, 0, 100);

  // 7. Costs.
  state.ledger.push({ w, kind: 'overhead', amount: -WEEKLY_OVERHEAD, memo: 'Staff, rent and licensing retainer' });
  const stored = state.products.reduce((s, p) => s + (p.inv?.warehouse ?? 0), 0);
  if (stored > 0) state.ledger.push({ w, kind: 'storage', amount: -Math.round(stored * STORAGE_PER_BOX * 100) / 100, memo: `Warehouse storage, ${stored.toLocaleString()} sealed boxes` });

  let delta = 0;
  let expenses = 0;
  for (const e of state.ledger.slice(ledgerStart)) {
    delta += e.amount;
    if (e.amount < 0) expenses -= e.amount;
  }
  state.company.cash = Math.round((state.company.cash + delta) * 100) / 100;
  if (state.ledger.length > 3000) state.ledger.splice(0, state.ledger.length - 3000);
  state.reports.push({ w, revenue, expenses, boxesSold, boxesOpened, secondaryCount: secondary.count, secondaryValue: Math.round(secondary.value), cash: state.company.cash, reputation: Math.round(state.company.reputation * 10) / 10 });
  if (state.reports.length > 260) state.reports.shift();
  if (state.company.cash < 0 && !state.news.some((n) => n.kind === 'cash-warning' && n.w > w - 8)) {
    addNews(state, { tone: 'bad', kind: 'cash-warning', title: 'The bank is calling', body: `Cash is ${fmtMoney(state.company.cash)}. Sell inventory or cut costs before the next print run.` });
  }
  return state;
}

function reportLeague(state: GameState, events: LeagueEvent[], prevFair: Record<string, number>) {
  const cardsOf = (pid: string) => Object.keys(state.cards).filter((id) => parseCardId(id).playerId === pid);
  const moveText = (pid: string) => {
    const ids = cardsOf(pid);
    if (!ids.length) return '';
    let before = 0;
    let after = 0;
    for (const id of ids) {
      if (!prevFair[id]) continue;
      before += prevFair[id];
      after += state.cards[id].fair;
    }
    if (!before) return '';
    const ch = after / before - 1;
    const sets = [...new Set(ids.map((id) => state.sets.find((s) => s.id === parseCardId(id).setId)!.name))];
    return ` Collector demand for ${sets.length > 1 ? 'cards from ' + sets.join(' and ') : `the ${sets[0]} cards`} moved ${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(0)}% this week.`;
  };
  let count = 0;
  for (const e of events) {
    const p = e.playerId ? state.players[e.playerId] : undefined;
    const team = p ? state.teams.find((t) => t.id === p.teamId) : undefined;
    const who = p ? `${playerName(p)} (${p.pos}, ${team?.abbr})` : '';
    const hasCards = p ? cardsOf(p.id).length > 0 : false;
    if (count >= 6 && !hasCards) continue;
    switch (e.kind) {
      case 'breakout': {
        const rookieNote = p && p.rookieYear >= seasonYear(state.week) - 1 ? ' The young player is suddenly must-have.' : '';
        addNews(state, { tone: 'good', kind: 'breakout', playerId: p!.id, title: `${who} breaks out`, body: `A string of big games has fans talking.${rookieNote}${moveText(p!.id)}` });
        break;
      }
      case 'slump':
        addNews(state, { tone: 'bad', kind: 'slump', playerId: p!.id, title: `${who} slumps`, body: `Three rough weeks and counting.${moveText(p!.id)}` });
        break;
      case 'injury':
      case 'season-ending':
        addNews(state, { tone: 'bad', kind: e.kind, playerId: p!.id, title: `${who} ${e.detail}`, body: `${e.kind === 'season-ending' ? 'Out for the rest of the season.' : 'A short-term absence.'}${moveText(p!.id)}` });
        break;
      case 'return':
        if (!hasCards) continue;
        addNews(state, { tone: 'good', kind: 'return', playerId: p!.id, title: `${who} returns`, body: `Back on the field.${moveText(p!.id)}` });
        break;
      case 'retired':
        addNews(state, { tone: 'neutral', kind: 'retired', playerId: p!.id, title: `${who} retires`, body: `${p!.skill > 82 ? 'A legend steps away; nostalgia buyers are circling.' : 'Another veteran walks away from the game.'}${moveText(p!.id)}` });
        break;
      case 'big-game':
        if (!hasCards && count >= 3) continue;
        addNews(state, { tone: 'good', kind: 'big-game', playerId: p!.id, title: `${who} ${e.detail}`, body: `${p!.season.yards ? `${p!.season.yards.toLocaleString()} yards and ${p!.season.tds} TDs this season.` : 'A highlight-reel day.'}${moveText(p!.id)}` });
        break;
      case 'rookie-class':
        addNews(state, { tone: 'neutral', kind: 'rookie-class', playerId: e.playerId, title: 'Draft night: a new rookie class', body: `${e.detail} Their first cards will carry the RC logo in next season's sets.` });
        break;
    }
    count++;
  }
}

/** Sanity helper used by tests and the UI. */
export function expectedBoxValue(state: GameState, productId: string) {
  const p = state.products.find((x) => x.id === productId)!;
  return boxExpectedValue(state, p).ev;
}

export { cardId, hitCategory, GameError };
