// Economy probe: plays the starter release and prints the weekly picture.
import { advanceWeek, manufacture, newGame } from '../src/sim/game';
import { productionSummary } from '../src/sim/catalog';
import { boxExpectedValue, estimate } from '../src/sim/market';
const seed = Number(process.argv[2] ?? 7);
let s = newGame(seed);
const sum = productionSummary(s, s.sets[0]);
console.log('cost', sum.totalCost.toFixed(0), 'print', sum.printCost.toFixed(0), 'rev potential', sum.projectedRevenue);
s = manufacture(s, s.sets[0].id);
console.log('EV at mfg', boxExpectedValue(s, s.products[0]).ev.toFixed(2));
for (let i = 0; i < 40; i++) {
  s = advanceWeek(s);
  const p = s.products[0]; const wk = p.weeks[p.weeks.length - 1]; const r = s.reports[s.reports.length - 1];
  console.log(s.week, 'cash', s.company.cash.toFixed(0), 'rep', s.company.reputation.toFixed(1), 'fat', s.market.fatigue.toFixed(2), wk ? `sold ${wk.sold} dem ${wk.demand} ev ${wk.ev} sent ${p.sentiment.toFixed(0)} vr ${p.valueRatio?.toFixed(2)} wh ${p.inv!.warehouse}` : '', 'sec', r.secondaryCount, r.secondaryValue);
}
const ests = Object.entries(s.cards).map(([id, m]) => [id, estimate(m, s.week), m.fair] as const).sort((a, b) => b[2] - a[2]);
for (const [id, e, f] of ests.slice(0, 8)) console.log(id, f.toFixed(2), e.value?.toFixed(2), e.confidence, e.sales);
for (const [id, e, f] of ests.slice(-4)) console.log(id, f.toFixed(2), e.value?.toFixed(2), e.confidence, e.sales);
console.log(s.news.slice(-15).map((n) => `${n.w} ${n.title}`).join('\n'));
