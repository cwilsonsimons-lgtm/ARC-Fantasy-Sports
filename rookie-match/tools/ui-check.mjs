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
page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
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

// Tankathon paste: the default import source.
await page.getByRole('button', { name: 'Import a big board / CSV' }).click();
check('Tankathon is the default import source', (await page.locator('.seg-on').innerText()) === 'Tankathon');
check('Tankathon link points at the NFL big board', (await page.locator('.steps a').getAttribute('href')) === 'https://www.tankathon.com/nfl/big_board');
await page.fill('#imp-text', ['2027 NFL Draft Big Board', '1', 'Tank Qb', 'QB | Texas', `6'4"`, '222 lbs', '2', 'Tank Swing', 'OT/IOL | Missouri', `6'5"`, '324 lbs', '3', 'Tank Nolen', 'EDGE | Texas', 'Sacks', '9'].join('\n'));
check('Tankathon paste finds players', /Found 3 players on the 2027 board/.test(await page.locator('.import-source').innerText()));
await page.getByRole('button', { name: /^Preview/ }).click();
check('missing measurements flagged, not guessed', /Height is required/.test(await page.locator('.import-table tbody tr').nth(2).innerText()));
check('board rank shown', (await page.locator('.import-table tbody tr').first().locator('td').first().innerText()) === '1');
await page.getByRole('button', { name: 'Import 2 prospects' }).click();
check('Tankathon import saved 2 players', (await counts()).includes('2 total'), await counts());
await search('IOL', `6'5"`, 324);
check('dual-listed OT/IOL player matches an IOL search exactly', (await names('.tier-exact'))[0] === 'Tank Swing');
await search('OT', `6'5"`, 324);
check('...and an OT search', (await names('.tier-exact'))[0] === 'Tank Swing');
await tab('Prospect Pool');

// NFL Mock Draft Database: no measurements on the board; existing players are skipped.
await page.getByRole('button', { name: 'Import a big board / CSV' }).click();
await page.getByRole('tab', { name: 'NFL Mock Draft Database' }).click();
check('MDDB tab warns that boards lack measurements', /not height and weight/.test(await page.locator('.import-source').innerText()));
await page.fill('#imp-text', ['2027 NFL Consensus Big Board', 'QB', 'RB', 'WR', '1', 'Jordan Newman', 'WR', 'Ohio State', '2', 'Tank Qb', 'QB', 'Texas'].join('\n'));
check('MDDB paste finds players', /Found 2 players/.test(await page.locator('.import-source').innerText()));
await page.getByRole('button', { name: /^Preview/ }).click();
check('player already in pool reads as skipped', /Already in your pool/.test(await page.locator('.import-table tbody tr').nth(1).innerText()));
await page.fill('input[aria-label$=" height"]', `6'1"`);
await page.fill('input[aria-label$=" weight"]', '200');
await page.getByRole('button', { name: 'Import 1 prospect' }).click();
check('MDDB player imported after filling measurements', (await counts()).includes('3 total'), await counts());

await page.getByRole('button', { name: 'Import a big board / CSV' }).click();
await page.getByRole('tab', { name: 'CSV / other list' }).click();
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
check('import saved 8 prospects', (await counts()).includes('11 total'), await counts());

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
// A near (not exact) search: the used player stays out of the suggestions.
await search('WR', `6'3"`, 217);
await page.getByRole('button', { name: 'Show all' }).click().catch(() => {});
// Two prospects share the name Exact Ed; the used one is the one from Alpha.
check('used prospect gone from suggestions', (await page.locator('.cand', { hasText: 'Alpha' }).count()) === 0 && (await page.locator('.cand', { hasText: 'Other U' }).count()) === 1);
await page.getByLabel('Show used prospects').check();
await page.getByRole('button', { name: 'Show all' }).click().catch(() => {});
const usedCard = page.locator('.cand', { hasText: 'Alpha' });
check('used toggle shows it, but disabled', (await usedCard.count()) === 1 && (await usedCard.isDisabled()));
await page.getByLabel('Show used prospects').uncheck();

// An exact search: the used player is suggested again and can be reused.
await search('WR', `6'3"`, 215);
const reuseCard = page.locator('.tier-exact .cand', { hasText: 'Alpha' });
check('exact match suggested even though used', (await reuseCard.count()) === 1 && !(await reuseCard.isDisabled()) && /can reuse/.test(await reuseCard.innerText()));
await reuseCard.click();
check('review warns the name is already in use', /already the name of another rookie/.test(await page.locator('.modal').innerText()));
await page.fill('#rv-team', 'Lions');
await page.getByRole('button', { name: 'Confirm assignment' }).click();
await page.waitForSelector('.success');
await tab('Assignment History');
check('history shows the reuse', (await page.locator('.hist-table .badge-reuse').count()) === 1 && (await page.locator('.hist-table tbody tr').count()) === 2);
await page.getByRole('button', { name: 'Undo Exact Ed' }).first().click(); // newest first: the reuse
check('undoing the reuse leaves the first use', (await page.locator('.hist-table tbody tr').count()) === 1 && (await counts()).includes('1 used'));
// Turning the setting off hides it again.
await tab('Settings & Data');
await page.uncheck('#set-reuse');
await search('WR', `6'3"`, 215);
check('setting off: exact used match hidden', (await page.locator('.cand', { hasText: 'Alpha' }).count()) === 0);
await tab('Settings & Data');
await page.check('#set-reuse');

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
check('copied workspace has everyone available', (await counts()).includes('11 total') && (await counts()).includes('0 used'), await counts());
await search('WR', `6'3"`, 215);
check('used status separate across workspaces', (await names('.tier-exact'))[0] === 'Exact Ed');
await page.selectOption('#ws-select', { label: 'My Draft Class' });
check('first workspace still has its assignment', (await counts()).includes('1 used'));

// ---- persistence across reload ----
await page.reload();
await page.waitForSelector('.topbar');
check('data survives refresh', (await counts()).includes('11 total') && (await counts()).includes('1 used') && (await page.locator('#ws-select option').count()) === 2);

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
check('restore brings everything back', (await counts()).includes('11 total') && (await counts()).includes('1 used'));
await page.reload();
await page.waitForSelector('.topbar');
check('restored data survives refresh', (await counts()).includes('1 used'));
const badPath = path.join(os.tmpdir(), `rm-bad-${Date.now()}.json`);
await writeFile(badPath, '{"app":"rookie-match","data":{"version":1}}');
await tab('Settings & Data');
await page.setInputFiles('input[aria-label="Restore from backup"]', badPath);
check('broken backup rejected without changes', (await page.locator('.notice-error').innerText()).includes('nothing was changed') && (await counts()).includes('11 total'));

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

// ---- claude.ai mode: account sync + save prompt, with a stand-in for the platform ----
// The stand-in keeps documents in a shared object, so a second browser context acts as a second device.
const cloud = {};
const saves = [];
async function claudePage() {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.route(/^https?:/, (r) => r.abort());
  await c.exposeFunction('__dbGet', (p) => cloud[p] ?? null);
  await c.exposeFunction('__dbSet', (p, d) => { cloud[p] = d; });
  await c.exposeFunction('__dbDel', (p) => { delete cloud[p]; });
  await c.exposeFunction('__save', (f, d) => { saves.push({ f, d }); });
  await c.exposeFunction('__dbList', (col) => Object.entries(cloud).filter(([k]) => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/')).map(([k, d]) => ({ id: k.slice(col.length + 1), d })));
  await c.addInitScript(() => {
    const ref = (path) => ({
      get: async () => { const d = await window.__dbGet(path); return { exists: d !== null, data: () => d ?? undefined }; },
      set: (d) => window.__dbSet(path, JSON.parse(JSON.stringify(d))),
      delete: () => window.__dbDel(path),
      collection: (sub) => ({ doc: (id) => ref(`${path}/${sub}/${id}`) }),
    });
    const col = (path) => ({
      limit: () => col(path),
      doc: (id) => ref(`${path}/${id}`),
      onSnapshot: (next) => {
        let last = '';
        const tick = async () => {
          const items = await window.__dbList(path);
          const key = JSON.stringify(items);
          if (key !== last) { last = key; next({ docs: items.map(({ id, d }) => ({ id, data: () => d })) }); }
        };
        tick();
        const t = setInterval(tick, 200);
        return () => clearInterval(t);
      },
    });
    const caps = {
      db: { doc: ref, collection: col },
      user: { id: async () => 'u_test' },
      downloads: { save: async ({ filename, data }) => { await window.__save(filename, data); return { status: 'saved' }; } },
    };
    window.claude = { use: (n) => new Promise((res) => setTimeout(() => res(caps[n] ?? null), 30)) };
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url);
  await p.waitForSelector('.topbar');
  return { c, p };
}
const devA = await claudePage();
await devA.p.waitForFunction(() => document.querySelector('.save-line')?.textContent.includes('Saved to your Claude account'));

// Looked-up measurements fill an NFL Mock Draft Database import; unknown names can be sent to Claude.
cloud['lookup/jeremiah-smith'] = { name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', height: `6'3"`, weight: 215, source: 'Tankathon profile', sourceUrl: 'https://www.tankathon.com/nfl/players/jeremiah-smith' };
await devA.p.locator('.tab', { hasText: 'Pool' }).click();
await devA.p.getByRole('button', { name: 'Import a big board / CSV' }).click();
await devA.p.getByRole('tab', { name: 'NFL Mock Draft Database' }).click();
await devA.p.fill('#imp-text', ['1', 'Jeremiah Smith', 'WR', 'Ohio State', '2', 'Marcus Unfound', 'CB', 'Somewhere State'].join('\n'));
await devA.p.getByRole('button', { name: /^Preview/ }).click();
await devA.p.waitForSelector('.lookup-note');
const firstRow = await devA.p.locator('.import-table tbody tr').first().innerText();
check('looked-up height and weight fill a board row', firstRow.includes(`6'3"`) && firstRow.includes('215') && /Tankathon profile/.test(firstRow), firstRow.replace(/\s+/g, ' '));
await devA.p.getByRole('button', { name: 'Ask Claude to look up 1 player' }).click();
await devA.p.waitForFunction(() => document.querySelector('.import-table')?.textContent.includes('Waiting for Claude'), null, { timeout: 3000 }).catch(() => {});
check('missing players are saved for Claude to look up', cloud['requests/marcus-unfound']?.school === 'Somewhere State', JSON.stringify(Object.keys(cloud).filter((k) => k.startsWith('requests'))) + ' ' + JSON.stringify(cloud['requests/marcus-unfound']));
check('row shows it is waiting for Claude', /Waiting for Claude/.test(await devA.p.locator('.import-table').innerText()));
await devA.p.screenshot({ path: `${out}/06-lookup.png`, fullPage: true });
const before = Number((await devA.p.locator('.counts .count b').first().innerText()));
await devA.p.getByRole('button', { name: 'Import 1 prospect' }).click();
check('filled player imports', Number(await devA.p.locator('.counts .count b').first().innerText()) === before + 1);
await devA.p.locator('.tab', { hasText: 'Match' }).first().click();
check('first visit copies data to the account', !!cloud['data/users/u_test/meta'] && Object.keys(cloud).some((k) => k.includes('/workspaces/')));
await devA.p.locator('.tab', { hasText: 'Settings & Data' }).click();
await devA.p.fill('#ws-name', 'Phone Class');
await devA.p.getByRole('button', { name: 'Create' }).click();
await devA.p.waitForFunction(() => document.querySelector('.save-line')?.textContent.startsWith('Saved to your'));
await devA.p.waitForTimeout(800);
check('changes reach the account', cloud['data/users/u_test/meta']?.workspaceIds?.length === 2);
await devA.p.getByRole('button', { name: 'Download backup (.json)' }).click();
await devA.p.waitForTimeout(200);
check('backup goes through the save prompt', saves.length === 1 && saves[0].f.endsWith('.json') && JSON.parse(saves[0].d).app === 'rookie-match');
const devB = await claudePage(); // empty browser storage: a second device
await devB.p.waitForFunction(() => document.querySelectorAll('#ws-select option').length === 2, null, { timeout: 5000 }).catch(() => {});
check('a second device loads the account copy', (await devB.p.locator('#ws-select option').allInnerTexts()).includes('Phone Class'));
check('second device shows account status', (await devB.p.locator('.save-line').innerText()).includes('Claude account'));
await devB.p.screenshot({ path: `${out}/05-claude-mode-phone.png`, fullPage: true });
await devA.c.close();
await devB.c.close();

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
