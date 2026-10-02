import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/sim/types';
import { advanceWeek, createProduct, manufacture, newGame, rngFor, STARTING_CASH, updateProduct, updateSet, makeVariant, breakWarehouseBox } from '../src/sim/game';
import { cardSupply, openBoxes, unopenedBoxes } from '../src/sim/inventory';
import { hitCategory, setCards } from '../src/sim/catalog';
import { hasErrors, validateSet } from '../src/sim/product';
import { boxExpectedValue, fairValue } from '../src/sim/market';
import { deserialize, serialize } from '../src/sim/save';

const starter = (seed = 7) => newGame(seed);
const firstSet = (s: GameState) => s.sets[0];
const firstProduct = (s: GameState) => s.products[0];

function assertConservation(s: GameState) {
  for (const set of s.sets.filter((x) => x.status !== 'draft')) {
    for (const card of setCards(set)) {
      const sup = cardSupply(s, card.id);
      expect(sup.vault + sup.sealed + sup.pulled, card.id).toBe(card.printRun);
      if (card.numbered) {
        const all: number[] = [...(set.leftoverSerials[card.id] ?? []), ...(s.cards[card.id]?.serials ?? [])];
        for (const p of s.products) if (p.setId === set.id && p.inv) all.push(...(p.inv.serials[card.id] ?? []));
        const sorted = [...all].sort((a, b) => a - b);
        expect(sorted, `serials of ${card.id}`).toEqual(Array.from({ length: card.printRun }, (_, i) => i + 1));
      }
    }
  }
}

describe('starter release', () => {
  it('is valid and manufacturable out of the box', () => {
    const s = starter();
    const issues = validateSet(s, firstSet(s));
    expect(hasErrors(issues), JSON.stringify(issues.filter((i) => i.level === 'error'))).toBe(false);
    const m = manufacture(s, firstSet(s).id);
    expect(firstSet(m).status).toBe('manufactured');
    expect(firstProduct(m).inv!.warehouse).toBe(firstProduct(m).boxes);
    assertConservation(m);
  });

  it('locks the checklist and print runs once manufactured', () => {
    const m = manufacture(starter(), starter().sets[0].id);
    expect(() => updateSet(m, firstSet(m).id, (set) => { set.variants[0].printRun += 1; })).toThrow(/locked/);
    expect(() => updateProduct(m, firstProduct(m).id, (p) => { p.boxes += 1; })).toThrow(/locked/);
    expect(() => manufacture(m, firstSet(m).id)).toThrow(/already manufactured/);
  });
});

describe('finite inventory', () => {
  it('conserves every copy and serial while every box is opened', () => {
    const s = manufacture(starter(3), starter(3).sets[0].id);
    const p = firstProduct(s);
    const slots = p.packsPerBox * p.cardsPerPack;
    const rng = rngFor(s, 'test');
    let opened = 0;
    let pulledTotal = 0;
    while (unopenedBoxes(p) > 0) {
      const k = Math.min(unopenedBoxes(p), 1 + Math.floor(rng.next() * 60));
      const { pulls } = openBoxes(s, p, k, rng);
      expect(pulls.length).toBe(k * slots);
      opened += k;
      pulledTotal += pulls.length;
      assertConservation(s);
    }
    expect(opened).toBe(p.boxes);
    expect(Object.keys(p.inv!.pool)).toHaveLength(0);
    expect(Object.keys(p.inv!.serials)).toHaveLength(0);
    expect(pulledTotal).toBe(p.boxes * slots);
    expect(() => openBoxes(s, p, 1, rng)).toThrow(/Only 0/);
  });

  it('never pulls the same serial twice', () => {
    const s = manufacture(starter(11), starter(11).sets[0].id);
    const p = firstProduct(s);
    const rng = rngFor(s, 'serials');
    const seen = new Set<string>();
    while (unopenedBoxes(p) > 0) {
      for (const x of openBoxes(s, p, Math.min(25, unopenedBoxes(p)), rng).pulls) {
        if (x.serial === undefined) continue;
        const key = `${x.cardId}#${x.serial}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('honours per-box guarantees in every single box, including when supply exactly matches', () => {
    let s = starter(5);
    const set = firstSet(s);
    const autoV = set.variants.find((v) => v.autographed)!;
    // 12 autos × 25 = 300 autographs; 300 boxes guaranteeing 1 each leaves zero slack.
    s = updateProduct(s, firstProduct(s).id, (p) => {
      p.boxes = 300;
      p.guarantees = [{ category: 'auto', perBox: 1 }, { category: 'numbered', perBox: 3 }];
    });
    s = updateSet(s, set.id, (x) => { x.variants[0].printRun = 900; });
    // 60×900 + 30×99 + 300 = 57,270 cards; 300 boxes × 80 = 24,000 slots → overrun trimmed from base.
    const issues = validateSet(s, firstSet(s));
    expect(hasErrors(issues), JSON.stringify(issues)).toBe(false);
    s = manufacture(s, set.id);
    const p = firstProduct(s);
    const rng = rngFor(s, 'g');
    const catOf = new Map(firstSet(s).variants.map((v) => [v.id, hitCategory(v)]));
    for (let b = 0; b < p.boxes; b++) {
      const { pulls } = openBoxes(s, p, 1, rng);
      const autos = pulls.filter((x) => catOf.get(x.cardId.split('|')[1]) === 'auto').length;
      const numbered = pulls.filter((x) => catOf.get(x.cardId.split('|')[1]) === 'numbered').length;
      expect(autos).toBe(1);
      expect(numbered).toBeGreaterThanOrEqual(3);
      expect(pulls.length).toBe(80);
    }
    expect(autoV.printRun).toBe(25);
    assertConservation(s);
  });

  it('splits a /10 between two products with disjoint serials', () => {
    let s = starter(9);
    const setId = firstSet(s).id;
    s = updateSet(s, setId, (set, st) => {
      set.variants.push(makeVariant(st, 'parallel', { name: 'Black /10', printRun: 10, numbered: true, playerIds: set.checklist.slice(0, 5) }));
    });
    const black = firstSet(s).variants.find((v) => v.name === 'Black /10')!;
    s = updateProduct(s, firstProduct(s).id, (p) => { p.alloc[black.id] = 5; });
    s = createProduct(s, setId, 'premium');
    const premium = s.products[1];
    s = updateProduct(s, premium.id, (p) => {
      p.alloc = { [black.id]: 5, [firstSet(s).variants[0].id]: 0 };
      p.packsPerBox = 1;
      p.cardsPerPack = 5;
      p.boxes = 5;
      p.price = 300;
    });
    expect(hasErrors(validateSet(s, firstSet(s))), JSON.stringify(validateSet(s, firstSet(s)))).toBe(false);
    s = manufacture(s, setId);
    for (const pid of firstSet(s).variants.find((v) => v.id === black.id)!.playerIds) {
      const id = `${setId}|${black.id}|${pid}`;
      const a = s.products[0].inv!.serials[id];
      const b = s.products[1].inv!.serials[id];
      expect(a).toHaveLength(5);
      expect(b).toHaveLength(5);
      expect([...a, ...b].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    assertConservation(s);
  });
});

describe('validation', () => {
  it('rejects conflicting allocations, shortages and impossible guarantees', () => {
    let s = starter();
    const set = firstSet(s);
    const gold = set.variants[1];
    s = createProduct(s, set.id, 'premium');
    s = updateProduct(s, s.products[1].id, (p) => { p.alloc[gold.id] = 10; });
    expect(validateSet(s, firstSet(s)).some((i) => i.level === 'error' && /only 99 exist/.test(i.msg))).toBe(true);

    let t = updateProduct(starter(), starter().products[0].id, (p) => { p.boxes = 2000; });
    expect(validateSet(t, firstSet(t)).some((i) => i.level === 'error' && /short/.test(i.msg))).toBe(true);

    t = updateProduct(starter(), starter().products[0].id, (p) => { p.guarantees = [{ category: 'auto', perBox: 1 }]; });
    expect(validateSet(t, firstSet(t)).some((i) => i.level === 'error' && /needs 415, but only 300/.test(i.msg))).toBe(true);
  });

  it('refuses to manufacture an invalid set', () => {
    const t = updateProduct(starter(), starter().products[0].id, (p) => { p.boxes = 2000; });
    expect(() => manufacture(t, firstSet(t).id)).toThrow();
  });
});

describe('economy and accounting', () => {
  function play(seed: number, weeks: number) {
    let s = starter(seed);
    s = manufacture(s, firstSet(s).id);
    for (let i = 0; i < weeks; i++) s = advanceWeek(s);
    return s;
  }

  it('keeps cash equal to starting cash plus the ledger, and box revenue equal to boxes sold × price', () => {
    const s = play(21, 30);
    const ledger = s.ledger.reduce((t, e) => t + e.amount, 0);
    expect(s.company.cash).toBeCloseTo(STARTING_CASH + ledger, 2);
    for (const p of s.products) {
      expect(p.revenue).toBeCloseTo(p.inv!.sold * p.price, 2);
      const ledgerSales = s.ledger.filter((e) => e.kind === 'box-sales' && e.ref === p.id).reduce((t, e) => t + e.amount, 0);
      expect(ledgerSales).toBeCloseTo(p.revenue, 2);
      expect(p.inv!.sold + p.inv!.warehouse).toBe(p.boxes);
    }
    const reportRevenue = s.reports.reduce((t, r) => t + r.revenue, 0);
    expect(reportRevenue).toBeCloseTo(s.products.reduce((t, p) => t + p.revenue, 0), 2);
    assertConservation(s);
  });

  it('box accounting: warehouse + sold = produced, opened = sold − still sealed', () => {
    let s = play(4, 6);
    const p = firstProduct(s);
    const r = breakWarehouseBox(s, p.id);
    s = r.state;
    const q = firstProduct(s);
    // One box was opened from the warehouse rather than sold.
    expect(q.inv!.warehouse + q.inv!.sold + 1).toBe(q.boxes);
    expect(q.inv!.opened).toBe(q.inv!.sold - q.inv!.collectorSealed + 1);
    assertConservation(s);
  });

  it('secondary sales never pay the manufacturer', () => {
    const s = play(8, 20);
    const kinds = new Set(s.ledger.filter((e) => e.amount > 0).map((e) => e.kind));
    expect([...kinds]).toEqual(['box-sales']);
    expect(s.reports.some((r) => r.secondaryCount > 0)).toBe(true);
  });

  it('a superstar base card can be worth more than a numbered parallel of an unpopular player', () => {
    const s = starter(13);
    const set = firstSet(s);
    const base = set.variants[0];
    const players = Object.values(s.players).filter((p) => p.status === 'active');
    const star = players.sort((a, b) => b.popularity - a.popularity)[0];
    const nobody = [...players].sort((a, b) => a.popularity - b.popularity)[0];
    const gold = { ...set.variants[1], printRun: 99 };
    expect(fairValue(s, set, base, star)).toBeGreaterThan(fairValue(s, set, gold, nobody));
  });

  it('box value falls when the biggest hits have been pulled', () => {
    const s = manufacture(starter(17), starter(17).sets[0].id);
    const p = firstProduct(s);
    const before = boxExpectedValue(s, p);
    // Remove the top chase cards from the pool as if they had been pulled.
    for (const c of before.chase.slice(0, 3)) {
      const serials = p.inv!.serials[c.id];
      if (serials) serials.splice(0, serials.length);
    }
    expect(boxExpectedValue(s, p).ev).toBeLessThan(before.ev);
  });
});

describe('saves and determinism', () => {
  it('round-trips through a save file and continues identically', () => {
    let s = starter(31);
    s = manufacture(s, firstSet(s).id);
    for (let i = 0; i < 8; i++) s = advanceWeek(s);
    const text = serialize(s);
    const loaded = deserialize(text);
    expect(loaded).toEqual(s);
    let a = s;
    let b = loaded;
    for (let i = 0; i < 6; i++) {
      a = advanceWeek(a);
      b = advanceWeek(b);
    }
    expect(serialize(b)).toBe(serialize(a));
  });

  it('rejects a tampered or truncated save', () => {
    const text = serialize(starter(2));
    expect(() => deserialize(text.slice(0, -40))).toThrow();
    expect(() => deserialize(text.replace('"cash":100000', '"cash":999999'))).toThrow(/integrity/);
  });

  it('replays the same seed and actions into identical state', () => {
    const run = () => {
      let s = starter(99);
      s = manufacture(s, firstSet(s).id);
      for (let i = 0; i < 12; i++) s = advanceWeek(s);
      return serialize(s);
    };
    expect(run()).toBe(run());
    let other = starter(100);
    other = manufacture(other, firstSet(other).id);
    expect(serialize(other)).not.toBe(serialize(manufacture(starter(99), firstSet(starter(99)).id)));
  });
});
