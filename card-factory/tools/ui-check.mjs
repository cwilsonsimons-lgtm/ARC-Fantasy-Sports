// Drives the built standalone page through the full Stage 1 loop in a real browser.
// Usage: node tools/build.mjs && node tools/ui-check.mjs [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const out = process.argv[2] ?? 'snapshots';
await mkdir(out, { recursive: true });
const url = 'file://' + path.resolve('dist/foil-and-ink.html');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
  await ctx.route(/^https?:/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
}
const nav = (page, label) => page.locator('.nav-item', { hasText: label }).click();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const { ctx, page, errors } = await newPage();
await page.goto(url);
await page.waitForSelector('.topbar');
check('dashboard renders', await page.locator('h1').first().isVisible(), await page.locator('h1').first().textContent());
check('next step names the starter set', (await page.locator('.next-step').textContent()).includes('Prime Gridiron'));
await page.screenshot({ path: `${out}/01-dashboard.png`, fullPage: true });

await nav(page, 'Set Creator');
await page.waitForSelector('.editor');
const summaryText = await page.locator('.section', { hasText: 'Base checklist' }).locator('.section-aside').textContent();
check('base checklist distinguishes unique cards from copies', /60 unique cards × 500 copies = 30,000 printed/.test(summaryText), summaryText);
check('live preview shows a card', await page.locator('.preview-panel .card').count() === 1);
// Edit the base print run and confirm the summary follows.
const run = page.locator('[id^="base-run-"]');
await run.fill('520');
await run.press('Enter');
await page.waitForTimeout(100);
check('base print run edit updates summary', (await page.locator('.section', { hasText: 'Base checklist' }).locator('.section-aside').textContent()).includes('31,200'));
await run.fill('500');
await run.press('Enter');
// Add a parallel, pick a preset, then remove it.
await page.getByRole('button', { name: 'Add numbered parallel' }).click();
const before = await page.locator('.variant').count();
await page.locator('.variant').last().getByRole('button', { name: '/10' }).click();
check('new parallel takes /10 preset', (await page.locator('.variant').last().textContent()).includes('× 10 ='));
await page.locator('.variant').last().getByRole('button', { name: 'Remove' }).click();
check('parallel added and removed', before === 3 && (await page.locator('.variant').count()) === 2);
await page.screenshot({ path: `${out}/02-set-creator.png`, fullPage: true });

await nav(page, 'Boxes & Packs');
await page.waitForSelector('.product');
check('box validates without errors', !(await page.locator('.product .issue-error').count()));
check('odds table present', (await page.locator('.product .table').nth(0).textContent()).includes('1:'));
// Break the box on purpose: impossible guarantee.
const autoG = page.locator('[id$="-auto"]').first();
await autoG.fill('2');
await autoG.press('Enter');
await page.waitForTimeout(100);
const err = await page.locator('.product .issue-error').first().textContent().catch(() => '');
check('impossible auto guarantee is explained', /needs 830, but only 300/.test(err), err);
await autoG.fill('0');
await autoG.press('Enter');
await page.waitForTimeout(100);
check('guarantee reset clears the error', !(await page.locator('.product .issue-error').count()));
await page.screenshot({ path: `${out}/03-boxes.png`, fullPage: true });

await nav(page, 'Manufacturing');
const cashBefore = await page.locator('.tb-stat b').first().textContent();
await page.getByRole('button', { name: /Manufacture for/ }).click();
await page.locator('.confirm').getByRole('button', { name: 'Manufacture' }).click();
await page.waitForTimeout(150);
const cashAfter = await page.locator('.tb-stat b').first().textContent();
check('manufacturing charges cash', cashBefore !== cashAfter, `${cashBefore} → ${cashAfter}`);
check('set moves to awaiting release', (await page.locator('.section', { hasText: 'Manufactured, awaiting release' }).textContent()).includes('Prime Gridiron'));
// Locked in the set creator.
await nav(page, 'Set Creator');
check('manufactured set is locked', await page.locator('[id^="base-run-"]').isDisabled());

for (let i = 0; i < 6; i++) {
  await page.getByRole('button', { name: /Advance week/ }).click();
  await page.waitForTimeout(80);
}
await nav(page, 'Manufacturing');
check('release ships and boxes sell', (await page.locator('.section', { hasText: 'On the market' }).textContent()).includes('sold'));
await page.screenshot({ path: `${out}/04-production.png`, fullPage: true });

// Break a warehouse box, if any are left.
const breakBtn = page.getByRole('button', { name: 'Break a box' }).first();
if (await breakBtn.count()) {
  await breakBtn.click();
  await page.getByRole('button', { name: 'Open box' }).click();
  await page.waitForSelector('.modal');
  await page.getByRole('button', { name: 'Rip next pack' }).click();
  check('ripping a pack reveals 8 cards', (await page.locator('.break-pack .card').count()) === 8);
  await page.getByRole('button', { name: 'Open all' }).click();
  check('opening the box reveals 80 cards', (await page.locator('.break-pack .card').count()) === 80);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/05-break.png`, fullPage: false });
  await page.keyboard.press('Escape');
} else check('warehouse box available to break', false, 'sold out already');

await nav(page, 'Market');
const rows = await page.locator('.section', { hasText: 'Singles' }).locator('tbody tr').count();
check('market lists pulled cards', rows > 10, `${rows} rows`);
await page.locator('#mk-kind').selectOption('auto');
await page.waitForTimeout(80);
await page.screenshot({ path: `${out}/06-market.png`, fullPage: true });
await page.locator('.section', { hasText: 'Singles' }).locator('tbody tr').first().click();
await page.waitForSelector('.modal .detail');
check('card detail shows a price history chart', (await page.locator('.modal .chart, .modal .chart-empty').count()) > 0);
check('card detail shows serial grid for /25', (await page.locator('.modal .serial-grid .serial').count()) === 25);
await page.screenshot({ path: `${out}/07-card-detail.png`, fullPage: false });
await page.keyboard.press('Escape');

await nav(page, 'News & Finance');
check('news feed has headlines', (await page.locator('.news-item').count()) > 3);
await page.screenshot({ path: `${out}/08-news.png`, fullPage: true });
await nav(page, 'League');
check('league table lists players', (await page.locator('tbody tr').count()) > 100);

// Saves: save to slot 1, then reload and confirm the autosave resumes at the same week.
await nav(page, 'Saves');
await page.locator('.slot', { hasText: 'Slot 1' }).getByRole('button', { name: 'Save here' }).click();
await page.waitForTimeout(150);
check('slot 1 shows the save', (await page.locator('.slot', { hasText: 'Slot 1' }).textContent()).includes('Week 7'));
const brand = await page.locator('.brand-sub').textContent();
await page.reload();
await page.waitForSelector('.topbar');
await page.waitForTimeout(250);
check('reload resumes the autosave', (await page.locator('.brand-sub').textContent()) === brand, `${brand} vs ${await page.locator('.brand-sub').textContent()}`);
await nav(page, 'Saves');
await page.locator('.slot', { hasText: 'Slot 1' }).getByRole('button', { name: 'Load' }).click();
await page.locator('.slot', { hasText: 'Slot 1' }).locator('.confirm').getByRole('button', { name: 'Load' }).click();
await page.waitForTimeout(150);
check('loading slot 1 works', (await page.locator('.brand-sub').textContent()) === brand);
// Export → import round trip.
await nav(page, 'Saves');
await page.getByRole('button', { name: 'Show save text' }).click();
const text = await page.locator('#export-text').inputValue();
await page.locator('#import-text').fill(text);
await page.getByRole('button', { name: 'Load pasted save' }).click();
await page.waitForTimeout(150);
check('export/import round trip', (await page.locator('.brand-sub').textContent()) === brand);
await nav(page, 'Saves');
await page.locator('#import-text').fill(text.replace('"cash":', '"cash":1'));
await page.getByRole('button', { name: 'Load pasted save' }).click();
await page.waitForTimeout(100);
check('tampered save is rejected', (await page.locator('.toast-bad').count()) > 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();

// Phone width, light and dark.
for (const scheme of ['light', 'dark']) {
  const { ctx: c2, page: p2, errors: e2 } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2 });
  await p2.goto(url);
  await p2.waitForSelector('.topbar');
  for (const tab of ['Dashboard', 'Set Creator', 'Boxes & Packs', 'Manufacturing', 'Market', 'News & Finance', 'Saves']) {
    await p2.getByRole('button', { name: 'Menu' }).click();
    await nav(p2, tab);
    await p2.waitForTimeout(80);
    const ov = await overflow(p2);
    check(`${scheme} phone: no horizontal scroll on ${tab}`, ov <= 0, `${ov}px`);
  }
  await p2.getByRole('button', { name: 'Menu' }).click();
  await nav(p2, 'Set Creator');
  await p2.screenshot({ path: `${out}/phone-${scheme}-sets.png`, fullPage: false });
  await p2.getByRole('button', { name: 'Menu' }).click();
  await nav(p2, 'Dashboard');
  await p2.screenshot({ path: `${out}/phone-${scheme}-dashboard.png`, fullPage: false });
  check(`${scheme} phone: no page errors`, e2.length === 0, e2.join(' | '));
  await c2.close();
}
const { ctx: c3, page: p3 } = await newPage({ colorScheme: 'dark' });
await p3.goto(url);
await p3.waitForSelector('.topbar');
await nav(p3, 'Set Creator');
await p3.screenshot({ path: `${out}/desktop-dark-sets.png`, fullPage: false });
await c3.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
