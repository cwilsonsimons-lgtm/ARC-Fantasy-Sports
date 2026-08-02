// Arc Markets — order entry, net positioning, portfolio independence, universe.
//
// The arithmetic checks matter most: crossing zero is the whole of B1, and it
// is invisible to a DOM assertion. The independence check is the other one —
// it proves a fantasy roster grants no shares, which is a rule about what
// *doesn't* happen and so has to be asserted deliberately.
//
// Usage: npm start (in one shell), then node tools/orders-check.mjs
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8080/index.html';
let pass = 0, fail = 0;
const errs = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route('**/*', r =>
  /^http:\/\/127\.0\.0\.1:8080\//.test(r.request().url()) ? r.continue() : r.abort());
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;
  errs.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => window.openMarkets());
await page.waitForTimeout(300);

const ev = (fn, arg) => page.evaluate(fn, arg);

console.log('\nB4 — tradeable universe');
ok('config block is exposed', await ev(() => window.UNIVERSE && window.UNIVERSE.SIZE === 100));
ok('positions are QB/RB/WR/TE only',
  await ev(() => window.MARKET.every(p => window.UNIVERSE.POSITIONS.includes(p.pos))));
ok('exactly SIZE contracts listed',
  await ev(() => window.MARKET.length === window.UNIVERSE.SIZE));
ok('eligibility comes from the prior completed season',
  await ev(() => {
    const hist = window.histSeason(window.UNIVERSE.PRIOR_SEASON)
      .filter(r => r.id && window.NFL_BY_ID[r.id] && window.UNIVERSE.POSITIONS.includes(r.pos))
      .sort((a, b) => b.ppr - a.ppr).slice(0, window.UNIVERSE.SIZE).map(r => r.id);
    return hist.every(id => window.isEligible(id));
  }));
// Scoped to the markets section: the fantasy app legitimately lists players who
// are not tradeable, and reading the whole document would find them there.
ok('an ineligible player is absent, not restricted',
  await ev(() => {
    const out = window.NFL_PLAYERS.filter(p => !window.isEligible(p.id)
      && window.UNIVERSE.POSITIONS.includes(p.pos)).slice(0, 40);
    return out.length > 0
      && out.every(p => !window.BY_ID[p.id])
      && out.every(p => !document.getElementById('mk').textContent.includes(p.full));
  }));
ok('blue chips get BLUE_CHIP_YEARS',
  await ev(() => window.MARKET.filter(p => window.contractTier(p.id) === 'blue')
    .every(p => p.years === window.UNIVERSE.BLUE_CHIP_YEARS)));
ok('the rest get STANDARD_YEARS',
  await ev(() => window.MARKET.filter(p => window.contractTier(p.id) === 'standard')
    .every(p => p.years === window.UNIVERSE.STANDARD_YEARS)));
ok('both tiers are populated',
  await ev(() => {
    const b = window.MARKET.filter(p => window.contractTier(p.id) === 'blue').length;
    return b === window.UNIVERSE.BLUE_CHIP_SIZE && b < window.MARKET.length;
  }));
ok('eligibility never recomputes mid-season',
  await ev(() => window.canRecompute('regular') === false
    && window.canRecompute('offseason') === true));

console.log('\nB3 — portfolio is independent of fantasy rosters');
ok('positions derive only from executed orders',
  await ev(() => {
    const ids = window.openPositions().map(r => r.id);
    return ids.every(id => window.orders().some(o => o.pid === id));
  }));
ok('a rostered player with no orders holds zero',
  await ev(() => {
    // draft the fantasy roster, then look for a market contract on it
    window.autoDraftAll();
    const roster = window.rosterFor('pandas').map(p => p.id).filter(Boolean);
    const untraded = roster.filter(id => window.BY_ID[id]
      && !window.orders().some(o => o.pid === id));
    return untraded.length > 0 && untraded.every(id => window.positionFor(id).qty === 0);
  }));
ok('no market module reads league state',
  await ev(() => !window.mkStore.team && !window.mkStore.players && !window.mkStore.draft));
ok('the two stores stay separate',
  await ev(() => {
    const mk = JSON.parse(localStorage.getItem('arc_markets_v1') || '{}');
    const fa = JSON.parse(localStorage.getItem('cbd_team_v1') || '{}');
    return !!mk.orders && !fa.orders && !mk.chat;
  }));

console.log('\nB1 — buy/sell only, net positioning');
ok('no short or cover control exists',
  await ev(() => !/\b(short|cover)\b/i.test(document.getElementById('mk').textContent)));
const cross = await ev(() => {
  // own 5, sell 6 -> net -1, on a contract with no prior orders
  const id = window.MARKET.find(p => !window.orders().some(o => o.pid === p.id)).id;
  const px = window.BY_ID[id].price;
  window.execute(id, 'buy', 5, px);
  const owned = window.positionFor(id).qty;
  window.execute(id, 'sell', 6, px);
  const after = window.positionFor(id);
  return { id, owned, qty: after.qty, avg: after.avg, px };
});
ok('own 5, sell 6 nets to -1', cross.owned === 5 && cross.qty === -1, cross);
ok('the remainder reprices at the fill', Math.abs(cross.avg - cross.px) < 0.01, cross);
const back = await ev(id => {
  // short 5 more (net -6), then buy 10 -> +4
  window.execute(id, 'sell', 5, window.BY_ID[id].price);
  const shorted = window.positionFor(id).qty;
  window.execute(id, 'buy', 10, window.BY_ID[id].price);
  return { shorted, qty: window.positionFor(id).qty };
}, cross.id);
ok('short 6, buy 10 nets out to +4', back.shorted === -6 && back.qty === 4, back);
ok('a negative position renders with a minus and its colour',
  await ev(() => {
    const s = window.qtyText(-12), c = window.qtyClass(-12);
    return /−12|-12/.test(s) && c === 'down' && window.qtyClass(12) === 'up';
  }));
ok('there is no separate short screen',
  await ev(() => !document.querySelector('[data-mkview="shorts"]')
    && document.querySelectorAll('.mk-view').length === 2));

console.log('\nB2 — docked trade bar and modal ticket');
await ev(() => window.mkOpenPlayer(window.MARKET[0].id));
// the sheet slides for .32s; geometry read before it settles is measured in a
// different frame of reference from the bar, which sits outside the transform
await page.waitForTimeout(600);
ok('player sheet shows position above the charts',
  await ev(() => {
    const b = document.getElementById('mkPosBlock'), c = document.getElementById('mkCharts');
    return !!b && !!c && (b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  }));
ok('trade bar is docked and visible',
  await ev(() => {
    const b = document.getElementById('mkTradeBar');
    const r = b.getBoundingClientRect(), nav = document.querySelector('.nav').getBoundingClientRect();
    // pinned above the nav, and outside the sheet's scroll box
    return b.classList.contains('on') && getComputedStyle(b).position === 'absolute'
      && !document.getElementById('mkSheet').contains(b)
      && Math.abs(r.bottom - nav.top) < 2;
  }));
ok('no inline order entry in the sheet body',
  await ev(() => !document.querySelector('#mkSheetBody .tk-side, #mkSheetBody .tk-step')));
ok('the bar holds at every scroll position',
  await ev(() => {
    const sh = document.getElementById('mkSheet'), bar = document.getElementById('mkTradeBar');
    sh.scrollTop = 0;
    const top = bar.getBoundingClientRect().top;
    sh.scrollTop = sh.scrollHeight;
    const bottom = bar.getBoundingClientRect().top;
    return top === bottom && bar.getBoundingClientRect().height > 0;
  }));
ok('the sheet can scroll clear of the bar',
  await ev(() => {
    const sh = document.getElementById('mkSheet'), bar = document.getElementById('mkTradeBar');
    sh.scrollTop = sh.scrollHeight;
    const last = document.querySelector('#mkSheetBody > *:last-child');
    return last.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1;
  }));

await page.click('.tb-go');
await page.waitForTimeout(250);
ok('TRADE opens the ticket', await ev(() => document.body.classList.contains('mk-ticket-open')));
ok('current position is at the top, after-fill at the bottom',
  await ev(() => {
    const b = document.getElementById('mkTicketBody');
    const pos = b.querySelector('.tk-pos'), after = b.querySelector('.tk-after');
    return !!pos && !!after
      && (pos.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
  }));
ok('buy and sell are the only sides', (await page.$$('.tk-side .sd')).length === 2);
ok('quantity stepper works',
  await ev(() => { window.mkTicketQty(4); return +document.getElementById('tkQty').value === 5; }));
ok('after-fill tracks the stepper',
  await ev(() => {
    const cur = +document.querySelector('.tk-pos .v').textContent.replace(/[^\d-]/g, '');
    const after = +document.querySelector('.tk-after .v').textContent.replace(/[^\d-]/g, '');
    return after === cur + 5;
  }));
ok('order type is a dropdown', await ev(() => {
  const s = document.querySelector('.tk-sel');
  return s && s.tagName === 'SELECT' && s.options.length === 2;
}));
ok('no limit field until Limit is chosen', await ev(() => !document.getElementById('tkLimit')));
await ev(() => window.mkTicketType('limit'));
await page.waitForTimeout(150);
ok('limit price appears when Limit is chosen', await ev(() => !!document.getElementById('tkLimit')));
await ev(() => window.mkTicketType('market'));
await page.waitForTimeout(120);
await ev(() => window.mkTicketReview());
await page.waitForTimeout(150);
ok('review stage renders before confirm',
  await ev(() => !!document.querySelector('.tk-review')
    && /confirm/i.test(document.querySelector('.tk-btn.go').textContent)));

const before = await ev(() => ({
  qty: window.positionFor(window.MARKET[0].id).qty,
  total: window.portfolioTotals().value,
  bp: window.portfolioTotals().buyingPower,
}));
await ev(() => window.mkTicketConfirm());
await page.waitForTimeout(250);
const after = await ev(() => ({
  qty: window.positionFor(window.MARKET[0].id).qty,
  total: window.portfolioTotals().value,
  bp: window.portfolioTotals().buyingPower,
  badge: (document.getElementById('mkPosBlock') || {}).textContent || '',
}));
ok('confirm fills and closes the ticket',
  await ev(() => !document.body.classList.contains('mk-ticket-open')));
ok('position updates in the same tick', after.qty === before.qty + 5, { before, after });
ok('the sheet badge repaints', /POSITION/.test(after.badge), after.badge);
ok('portfolio value recalculates', after.total !== before.total);
ok('buying power recalculates', after.bp < before.bp);
ok('realized P/L is exposed', await ev(() => typeof window.portfolioTotals().realized === 'number'));

console.log('\nB3 — portfolio screen');
await ev(() => window.mkView('portfolio'));
await page.waitForTimeout(250);
ok('every non-zero position is listed',
  await ev(() => document.querySelectorAll('#mkPortfolio .mk-row').length
    === window.openPositions().length));
ok('sort control is a dropdown, not chips',
  await ev(() => {
    const s = document.querySelector('.mk-sortsel');
    return s && s.tagName === 'SELECT' && s.options.length === 4
      && !document.querySelector('#mkPortfolio .mk-pill');
  }));
ok('sorting reorders the rows',
  await ev(() => {
    const first = () => document.querySelector('#mkPortfolio .mk-row .nm').textContent;
    window.mkSortBy('value'); const a = first();
    window.mkSortBy('name');  const b = first();
    return a !== b;
  }));
ok('a short position shows a minus in the list',
  await ev(() => {
    window.mkSortBy('value');
    return window.openPositions().some(r => r.qty < 0)
      && /−/.test(document.getElementById('mkPortfolio').textContent);
  }));

console.log('\nno currency marks');
ok('no dollar sign anywhere in the section',
  await ev(() => !document.getElementById('mk').textContent.includes('$')));

ok('no page errors', errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
