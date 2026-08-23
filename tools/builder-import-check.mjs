// Checks the StatsDeck import path end to end, through the real UI.
//
// Usage: node tools/builder-import-check.mjs [url]   (defaults to the dist build)
//
// It drives the actual file input with tools/sample-league-data.json rather than
// calling the merge function directly, because the parts most likely to break
// are the seams: which team an exported name resolves to, what an import is
// allowed to overwrite, and whether the facts reach the suggestion list.
import { chromium } from 'playwright';

const url = process.argv[2] || 'file://' + process.cwd() + '/dist/matchup-builder.html';
const fixture = process.cwd() + '/tools/sample-league-data.json';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0]));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

let pass = 0, fail = 0;
async function check(label, got, want) {
  const value = typeof got === 'function' ? await got() : got;
  const ok = typeof want === 'function' ? want(value) : JSON.stringify(value) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${JSON.stringify(value)}`);
  ok ? pass++ : fail++;
}

const league = () => page.evaluate(`JSON.parse(localStorage.getItem('cityboys-league-v1') || '{}')`);
const tab = async (name) => { await page.getByRole('button', { name }).click(); await page.waitForTimeout(300); };

// A caption typed before the import must survive it — it is the one thing on
// the graphic that nobody else can supply.
await tab('SCHEDULE');
await page.getByRole('button', { name: 'LOAD 2026 SCHEDULE' }).click();
await page.waitForTimeout(1400);   // the league autosave is debounced
await page.evaluate(`(() => {
  const lg = JSON.parse(localStorage.getItem('cityboys-league-v1'));
  lg.weeks[0][0].bb = 'hand-written caption';
  localStorage.setItem('cityboys-league-v1', JSON.stringify(lg));
})()`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await tab('SCHEDULE');

await page.setInputFiles('input[type=file][accept*="json"]', fixture);
await page.waitForTimeout(1200);

await check('the import reports what it did',
  () => page.locator('text=/^Imported /').first().innerText(), t => /10 matchups across 2 weeks/.test(t));
await check('no team went unrecognised',
  () => page.locator('text=/^Imported /').first().innerText(), t => !/not recognised/.test(t));
await check('finals land on the right teams',
  async () => { const lg = await league(); const g = lg.weeks[0][0]; return [g.a, g.b, g.sa, g.sb]; },
  ['dones', 'dakyard', '131.4', '98.2']);
await check('a team named in full resolves',
  async () => (await league()).weeks[0][1].a, 'barzal');
await check('a team named by manager resolves',
  async () => { const g = (await league()).weeks[0][2]; return [g.a, g.b]; }, ['vick', 'burrow']);
await check('a week with no scores still imports',
  async () => { const g = (await league()).weeks[1][0]; return [g.a, g.b, g.sa]; }, ['dones', 'vick', '']);
await check('typed captions survive the import',
  async () => (await league()).weeks[0][0].bb, 'hand-written caption');
await check('facts are stored per team',
  async () => Object.keys((await league()).facts || {}).sort(), ['dakyard', 'dones']);

// the imported results have to reach the graphic, not just the store
await tab('SCORES');
await check('scores show on the scores tab',
  () => page.locator('input[inputmode=decimal]').first().inputValue(), '131.4');
await tab('GRAPHIC');
await page.locator('select').nth(2).selectOption({ index: 1 });   // entering Wk 2
await page.waitForTimeout(300);
await page.locator('button').filter({ hasText: ' vs ' }).first().click();
await page.waitForTimeout(600);
await check('records come off the imported finals',
  () => page.evaluate(`(() => {
    const c = document.querySelector('canvas').getContext('2d');
    return c.getImageData(568, 186, 234, 200).data.some(v => v > 200);
  })()`), true);
await page.getByRole('button', { name: /Suggest a line/ }).first().click();
await page.waitForTimeout(400);
await check('imported facts reach the suggestions',
  () => page.locator('button').filter({ hasText: /^\(/ }).allInnerTexts(),
  lines => lines.some(l => l.includes('Left 41.2 on the bench')));
// ordering: this season's facts beat last season's receipts
await check('facts rank above last season',
  () => page.locator('button').filter({ hasText: /^\(/ }).allInnerTexts(),
  lines => {
    const fact = lines.findIndex(l => l.includes('Left 41.2 on the bench'));
    const hist = lines.findIndex(l => l.includes('last year'));
    return fact > -1 && hist > -1 && fact < hist;
  });

console.log(`\n${pass} passed, ${fail} failed${errors.length ? '\n' + errors.join('\n') : ''}`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
