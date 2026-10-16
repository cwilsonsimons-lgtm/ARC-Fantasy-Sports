// Drives the built page through the required behaviours in a real browser.
// Usage: node tools/build.mjs && node tools/ui-check.mjs [screenshotDir]
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const out = process.argv[2] ?? 'snapshots';
await mkdir(out, { recursive: true });
const url = 'file://' + path.resolve('dist/rookie-match.html');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/^https?:/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => { errors.push(`unexpected native dialog: ${d.message()}`); d.dismiss(); });

const tab = (label) => page.locator('.tab', { hasText: label }).click();
const names = (sel) => page.locator(`${sel} .cand-name`).evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
const counts = async () => (await page.locator('.counts').innerText()).replace(/\s+/g, ' ');
async function search(pos, h, w) {
  await tab('Find a Match');
  const done = page.getByRole('button', { name: 'Match Next Rookie →' });
  if (await done.count()) await done.click();
  await page.selectOption('#gen-pos', pos);
  await page.fill('#gen-height', h);
  await page.fill('#gen-weight', String(w));
}
async function confirmTop(fields = {}) {
  await page.getByRole('button', { name: 'Review top match' }).click();
  for (const [id, v] of Object.entries(fields)) await page.fill(id, v);
  await page.getByRole('button', { name: 'Confirm assignment' }).click();
  await page.waitForSelector('.success');
}

await page.goto(url);
await page.waitForSelector('.topbar');

// ---- start from a clean, known pool: remove samples, import our own ----
await tab('Prospect Pool');
check('sample pool is present and labelled', (await page.locator('.badge-sample').count()) > 10);
await page.getByRole('button', { name: 'Remove samples' }).click();
await page.locator('.modal').getByRole('button', { name: 'Remove samples' }).click();
check('samples removed', (await counts()).includes('0 total'), await counts());

await page.getByRole('button', { name: 'Import CSV / paste' }).click();
await page.fill('#imp-text', [
  'Player,Pos,Ht,Wt,College',
  `Exact Ed,WR,6'3",215,Alpha`,
  'Edge Eli,WR,6-4,220,Beta',
  'Low Lou,WR,74,210,Gamma',
  'Heavy Hal,WR,75 in,221,Delta',
  `Tall Tom,WR,6' 5",215,Epsilon`,
  'Back Ben,HB,5-11,205,Zeta',
  'Bad Height,WR,6.3,215,Eta',
  'Exact Ed,WR,6-3,215,Alpha',
  'Exact Ed,WR,6-1,200,Other U',
].join('\n'));
await page.getByRole('button', { name: /^Preview/ }).click();
await page.waitForSelector('.import-preview');
check('header row detected and fields mapped', await page.locator('.map-col select').evaluateAll((s) => s.map((x) => x.value).join()) === 'name,position,height,weight,college');
const heightCells = await page.locator('.import-table tbody tr:not(.row-error) td[data-label="height"]').allInnerTexts();
check('imported height formats normalise', heightCells.slice(0, 6).join(' ') === `6'3" 6'4" 6'2" 6'3" 6'5" 5'11"`, heightCells.join(' '));
check('HB normalised to RB', (await page.locator('tr[data-line="7"] td[data-label="position"]').innerText()) === 'RB');
check('ambiguous height flagged, not guessed', /ambiguous/.test(await page.locator('tr[data-line="8"]').innerText()));
check('duplicate flagged', /Possible duplicate/.test(await page.locator('tr[data-line="9"]').innerText()));
check('same name, other college not treated as duplicate', /Shares a name/.test(await page.locator('tr[data-line="10"]').innerText()));
await page.screenshot({ path: `${out}/01-import-preview.png`, fullPage: true });
// Fix the bad row inline.
await page.fill('tr[data-line="8"] input[aria-label="Line 8 height"]', `6'0"`);
check('fixing a row makes it importable', (await page.locator('.modal-foot').innerText()).includes('8 prospects ready'), await page.locator('.modal-foot .foot-left').innerText());
await page.getByRole('button', { name: 'Import 8 prospects' }).click();
check('import saved 8 prospects', (await counts()).includes('8 total'), await counts());

// ---- matching tiers ----
await search('WR', `6'3"`, 215);
await page.waitForSelector('.results');
check('exact measurements rank first', (await names('.tier-exact'))[0] === 'Exact Ed', (await names('.tier-exact')).join());
const pref = await names('.tier-preferred');
check('1 inch and 5 lb away is in preferred tier', pref.includes('Edge Eli') && pref.includes('Low Lou'), pref.join());
await page.getByRole('button', { name: 'Show all' }).click().catch(() => {});
const fb = await names('.tier-fallback');
check('outside either limit only in fallback', fb.includes('Heavy Hal') && fb.includes('Tall Tom') && !pref.includes('Heavy Hal') && !pref.includes('Tall Tom'), fb.join());
check('signed differences shown', (await page.locator('.cand', { hasText: 'Low Lou' }).innerText()).includes('1 inch shorter, 5 pounds lighter'));
check('other positions excluded', !(await page.locator('.results').innerText()).includes('Back Ben'));
await page.screenshot({ path: `${out}/02-find.png`, fullPage: true });

// No preferred matches: explicit message + fallbacks.
await search('WR', `6'8"`, 260);
check('no-preferred-range message shown', /No available WRs within your preferred range/.test(await page.locator('.notice-warn').innerText()));
check('fallbacks shown when nothing is in range', (await names('.tier-fallback')).length > 0);

// ---- assign, used exclusion, undo ----
await search('WR', `6'3"`, 215);
await page.locator('.tier-exact .cand').first().click();
check('selecting opens a review, nothing assigned yet', (await page.locator('.modal').count()) === 1 && (await counts()).includes('0 used'));
await page.getByRole('button', { name: 'Back to suggestions' }).click();
await confirmTop({ '#rv-orig': 'Gen Rookie', '#rv-team': 'Bears' });
check('confirm marks prospect used', (await counts()).includes('1 used'), await counts());
await page.screenshot({ path: `${out}/03-assigned.png` });
await page.getByRole('button', { name: 'Match Next Rookie →' }).click();
const focused = await page.waitForFunction(() => document.activeElement?.id === 'gen-pos', null, { timeout: 2000 }).then(() => true, () => false);
check('Match Next clears fields and focuses position', (await page.inputValue('#gen-height')) === '' && focused);
await search('WR', `6'3"`, 215);
await page.getByRole('button', { name: 'Show all' }).click().catch(() => {});
// Two prospects share the name Exact Ed; the used one is the one from Alpha.
check('used prospect gone from suggestions', (await page.locator('.cand', { hasText: 'Alpha' }).count()) === 0 && (await page.locator('.cand', { hasText: 'Other U' }).count()) === 1);
await page.getByLabel('Show used prospects').check();
await page.getByRole('button', { name: 'Show all' }).click().catch(() => {});
const usedCard = page.locator('.cand', { hasText: 'Alpha' });
check('used toggle shows it, but disabled', (await usedCard.count()) === 1 && (await usedCard.isDisabled()));
await page.getByLabel('Show used prospects').uncheck();

await tab('Assignment History');
const histText = await page.locator('.hist-table').innerText();
check('history records the assignment details', /Exact Ed/.test(histText) && /Gen Rookie/.test(histText) && /Bears/.test(histText) && /WR · 6'3" · 215 lb/.test(histText));
await page.getByRole('button', { name: 'Undo Exact Ed' }).click();
check('undo restores availability', (await counts()).includes('0 used'));
await search('WR', `6'3"`, 215);
check('undone prospect suggested again', (await names('.tier-exact'))[0] === 'Exact Ed');
await confirmTop();

// ---- workspaces ----
await tab('Settings & Data');
await page.fill('#ws-name', 'Season 2');
await page.selectOption('#ws-copy', { index: 1 });
await page.getByRole('button', { name: 'Create' }).click();
check('copied workspace has everyone available', (await counts()).includes('8 total') && (await counts()).includes('0 used'), await counts());
await search('WR', `6'3"`, 215);
check('used status separate across workspaces', (await names('.tier-exact'))[0] === 'Exact Ed');
await page.selectOption('#ws-select', { label: 'My Draft Class' });
check('first workspace still has its assignment', (await counts()).includes('1 used'));

// ---- persistence across reload ----
await page.reload();
await page.waitForSelector('.topbar');
check('data survives refresh', (await counts()).includes('8 total') && (await counts()).includes('1 used') && (await page.locator('#ws-select option').count()) === 2);

// ---- backup / restore ----
await tab('Settings & Data');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup (.json)' }).click()]);
const backupPath = path.join(os.tmpdir(), `rm-backup-${Date.now()}.json`);
await dl.saveAs(backupPath);
const backup = JSON.parse(await readFile(backupPath, 'utf8'));
check('backup holds workspaces, prospects, assignments and settings', backup.app === 'rookie-match' && backup.data.workspaces.length === 2 && backup.data.settings.heightTol === 1);
// Wreck the data, then restore.
await page.getByRole('button', { name: 'Clear prospects & assignments' }).click();
await page.locator('.modal').getByRole('button', { name: 'Clear workspace' }).click();
check('destructive clear (after confirm) emptied the workspace', (await counts()).includes('0 total'));
await page.setInputFiles('input[aria-label="Restore from backup"]', backupPath);
check('restore asks before replacing', (await page.locator('.modal').innerText()).includes('replace everything'));
await page.locator('.modal').getByRole('button', { name: 'Replace with backup' }).click();
check('restore brings everything back', (await counts()).includes('8 total') && (await counts()).includes('1 used'));
await page.reload();
await page.waitForSelector('.topbar');
check('restored data survives refresh', (await counts()).includes('1 used'));
const badPath = path.join(os.tmpdir(), `rm-bad-${Date.now()}.json`);
await writeFile(badPath, '{"app":"rookie-match","data":{"version":1}}');
await tab('Settings & Data');
await page.setInputFiles('input[aria-label="Restore from backup"]', badPath);
check('broken backup rejected without changes', (await page.locator('.notice-error').innerText()).includes('nothing was changed') && (await counts()).includes('8 total'));

// ---- CSV template + exports ----
await tab('Prospect Pool');
const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV template' }).click()]);
check('CSV template downloads', (await readFile(await tpl.path(), 'utf8')).startsWith('name,position,height,weight'));
const [pcsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
check('prospect CSV export includes status', /Exact Ed,WR,"6'3""",75,215,Alpha,,used/.test(await readFile(await pcsv.path(), 'utf8')));

// ---- mobile layout ----
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(url);
await m.selectOption('#gen-pos', 'WR');
await m.fill('#gen-height', '6-3');
await m.fill('#gen-weight', '216');
await m.waitForSelector('.cand');
check('no horizontal scroll on phone', (await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
await m.screenshot({ path: `${out}/04-mobile.png`, fullPage: true });

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
