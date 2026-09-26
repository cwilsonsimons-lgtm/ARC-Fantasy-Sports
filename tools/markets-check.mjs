// Interaction checks for Arc Markets.
//
// Usage: node tools/markets-check.mjs [url]        (defaults to the dist build)
//
// Two of these exist because of bugs that shipped: the sheet once carried the
// same class name on <body> as on the sheet element, which applied the sheet's
// own `position:absolute; transform:translateY(102%)` to <body> and slid the
// whole app off screen; and .face was styled only inside cards and rows, so a
// face used anywhere else rendered its remote headshot at natural size. Neither
// showed up in DOM assertions - both need geometry.
import { chromium } from 'playwright';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/index.html';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 436, height: 920 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1300);

// Pretend the remote headshots resolve, so layout is tested the way a user with
// a working network sees it rather than the way an offline sandbox does.
await page.evaluate(`(() => {
  const c = document.createElement('canvas'); c.width = c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#3a5'; x.fillRect(0, 0, 600, 600);
  const url = c.toDataURL('image/png');
  MARKET.forEach(m => { m.hs = url; });
})()`);

let pass = 0, fail = 0;
async function check(label, code, want) {
  const got = await page.evaluate(code).catch(e => 'ERR: ' + e.message);
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(30)} ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
  await page.waitForTimeout(120);
}

// the app must never be pushed off screen, whatever is open
const anchored = `(() => ({ bodyY: document.body.getBoundingClientRect().y | 0,
  docH: document.documentElement.scrollHeight }))()`;
const isAnchored = r => r && r.bodyY === 0 && r.docH <= 940;

await check('opens from the app nav', `document.querySelector('.nav .nv[data-nav=markets]').click();
  document.body.classList.contains('markets')`, true);
await check('market rows render', `document.querySelectorAll('#mkMarket .mk-row').length`, n => n > 100);
await check('app nav still has 4 tabs', `document.querySelectorAll('.nav .nv').length`, 4);
await check('layout anchored', anchored, isAnchored);

await check('faces are 38px in rows', `(()=>{const r=document.querySelector('#mkMarket .mk-row .face')
  .getBoundingClientRect(); return [r.width|0, r.height|0];})()`, [38, 38]);

await check('portfolio via header btn', `document.getElementById('mkPfBtn').click();
  document.querySelectorAll('#mkPortfolio .mk-row').length`, 28);
await check('portfolio btn is active', `document.getElementById('mkPfBtn').classList.contains('on')`, true);
await check('toggles back to market', `document.getElementById('mkPfBtn').click();
  document.querySelector('.mk-view.on').dataset.mkview`, 'market');

await check('position filter', `mkFilter('QB');
  [...document.querySelectorAll('#mkMarket .mk-row .sb')].every(e => /QB/.test(e.textContent))`, true);
await check('price sort flips', `mkFilter('All'); const a = document.querySelector('#mkMarket .mk-row .p').textContent;
  mkSort(); const b = document.querySelector('#mkMarket .mk-row .p').textContent; mkSort(); a !== b`, true);
await check('watchlist star', `document.querySelector('#mkMarket .star').click();
  JSON.parse(localStorage.getItem('arc_markets_v1')).watch.length`, 1);

await check('row opens the sheet', `document.querySelector('#mkMarket .mk-row').click();
  document.querySelectorAll('#mkSheetBody .mk-curve .yr').length`, 3);
await check('sheet is on screen', `(()=>{const r=document.getElementById('mkSheet').getBoundingClientRect();
  return r.y < innerHeight && r.y > 0;})()`, true);
await check('layout anchored w/ sheet', anchored, isAnchored);
await check('sheet face is 52px', `(()=>{const r=document.querySelector('#mkSheetBody .face')
  .getBoundingClientRect(); return [r.width|0, r.height|0];})()`, [52, 52]);
await check('sheet closes off screen', `mkCloseSheet(); new Promise(r => setTimeout(() =>
  r(document.getElementById('mkSheet').getBoundingClientRect().y >= innerHeight), 450))`, true);

await check('highlight card opens sheet', `document.querySelector('.mk-card').click();
  document.querySelectorAll('#mkSheetBody .mk-curve .yr').length`, 3);
await check('about sheet', `mkCloseSheet(); mkAbout();
  /Concept only/.test(document.getElementById('mkSheetBody').textContent)`, true);
await check('layout anchored w/ about', anchored, isAnchored);

await check('Matchup leaves markets', `mkCloseSheet();
  document.querySelector('.nav .nv[data-nav=matchup]').click(); document.body.classList.contains('markets')`, false);
await check('fantasy app still renders', `!!document.querySelector('.view.on')`, true);
await check('fantasy store untouched', `!!localStorage.getItem('cbd_team_v1')`, true);
await check('re-enters cleanly', `openMarkets(); document.querySelectorAll('#mkMarket .mk-row').length`, n => n > 100);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed, ${errors.length} page errors`);
if (errors.length) console.log(errors.join('\n'));
process.exit(fail || errors.length ? 1 : 0);
