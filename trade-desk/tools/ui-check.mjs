// Drives the built artifact in Chromium with a stand-in for the claude.ai runtime (an in-memory
// db seeded from a seed file, and a StatsDeck stub that replays saved payloads).
// Usage: node tools/build.mjs && node tools/ui-check.mjs <seed.json> [payloads.json] [screenshotDir]
//   seed.json      from tools/seed.ts
//   payloads.json  the StatsDeck payloads seed.ts was built from (enables the sync check)
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const [seedFile, payloadFile, out = 'snapshots'] = process.argv.slice(2);
if (!seedFile) {
  console.error('usage: node tools/ui-check.mjs <seed.json> [payloads.json] [screenshotDir]');
  process.exit(2);
}
await mkdir(out, { recursive: true });
const seed = await readFile(seedFile, 'utf8');
const payloads = payloadFile ? await readFile(payloadFile, 'utf8') : 'null';
const body = await readFile('dist/artifact.html', 'utf8');

// Same API surface the page uses: claude.use('db' | 'user' | 'mcp').
const runtime = `
<script>
(() => {
  const store = new Map(Object.entries(${seed}));
  const subs = new Set();
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const snap = (p) => ({ id: p.split('/').pop(), exists: store.has(p), data: () => store.get(p) && JSON.parse(JSON.stringify(store.get(p))), metadata: { fromCache: false, hasPendingWrites: false } });
  const emit = () => subs.forEach((s) => s());
  const docRef = (p) => ({
    path: p,
    get: async () => snap(p),
    set: async (d) => { store.set(p, JSON.parse(JSON.stringify(d))); window.__writes = (window.__writes || 0) + 1; setTimeout(emit); },
    update: async (d) => { store.set(p, { ...store.get(p), ...d }); setTimeout(emit); },
    delete: async () => { store.delete(p); setTimeout(emit); },
    onSnapshot(next) { const f = () => next(snap(p)); subs.add(f); setTimeout(f); return () => subs.delete(f); },
  });
  const colRef = (c) => ({
    path: c,
    doc: (id) => docRef(c + '/' + id),
    onSnapshot(next) {
      const f = () => { const docs = [...store.keys()].filter((k) => parent(k) === c).sort().map(snap); next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } }); };
      subs.add(f); setTimeout(f); return () => subs.delete(f);
    },
  });
  const db = { doc: docRef, collection: colRef };
  const P = ${payloads};
  const mcp = {
    async callTool(server, tool, input) {
      await new Promise((r) => setTimeout(r, 20));
      if (!P) throw { code: 'server_not_connected', message: 'no' };
      if (tool === 'get_standings') return { payload: { success: true, data: P.standings } };
      if (tool === 'get_trades') return { payload: { success: true, data: P.trades } };
      if (tool === 'get_my_roster') return { payload: { success: true, data: P.teams['Jumpin’ Uncs'] } };
      if (tool === 'get_league_team') {
        const q = input.team_query.toLowerCase();
        const hits = Object.keys(P.teams).filter((n) => n.toLowerCase().includes(q) || (q.includes('balls') && n.toLowerCase().includes('balls')));
        if (hits.length !== 1) return { payload: { success: true, data: { needs_pick: true, candidates: hits.map((name) => ({ name })) } } };
        return { payload: { success: true, data: P.teams[hits[0]] } };
      }
      if (tool === 'get_player_stats') {
        const games = [8.8, 5.5, 2.7, 2.0, 3.4, 1.7, 24.3, 11.4, 38.1, 29.3].map((fantasy_points, i) => ({ week: i + 1, date: '2026-' + String(9 + Math.floor(i / 4)).padStart(2, '0') + '-' + String(7 + (i % 4) * 7).padStart(2, '0'), fantasy_points }));
        return { payload: { success: true, data: { games } } };
      }
      throw { code: 'tool_error', message: 'unknown tool' };
    },
  };
  window.__store = store;
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'user' ? { canEdit: async () => true } : n === 'mcp' ? mcp : null) };
})();
</script>`;

const skeleton = (dark) => `<!doctype html><html${dark ? ' data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${runtime}${body}</body></html>`;
const dir = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'td-ui-'));
const light = path.join(dir, 'light.html');
const dark = path.join(dir, 'dark.html');
await writeFile(light, skeleton(false));
await writeFile(dark, skeleton(true));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const reactUmd = {
  'react.production.min.js': await readFile('node_modules/react/umd/react.production.min.js', 'utf8'),
  'react-dom.production.min.js': await readFile('node_modules/react-dom/umd/react-dom.production.min.js', 'utf8'),
};
async function context(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route(/^https?:/, (r) => {
    const f = Object.keys(reactUmd).find((k) => r.request().url().endsWith(k));
    return f ? r.fulfill({ body: reactUmd[f], contentType: 'text/javascript' }) : r.abort();
  });
  return ctx;
}

const ctx = await context({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
const tab = (label) => page.locator('.tab', { hasText: label }).click();

await page.goto('file://' + light);
await page.waitForSelector('.teamname');
check('my team loads', (await page.locator('.teamname').innerText()).toLowerCase().includes('uncs'));
const rows = await page.locator('main .tbl tbody tr').count();
check('roster rows render', rows > 15, `${rows} rows`);
await page.screenshot({ path: `${out}/roster-desktop.png`, fullPage: false });

// Player sheet
await page.locator('main .tbl tbody tr', { hasText: 'Jaylen Warren' }).first().click();
await page.waitForSelector('.sheet');
check('sheet lists every team', (await page.locator('.sheet .tbl tbody tr').count()) === 10);
check('sheet draws the value chart', (await page.locator('.sheet .chart svg circle').count()) >= 2);
await page.locator('.sheet button', { hasText: 'Rebuild from game logs' }).click();
await page.waitForFunction(() => document.querySelectorAll('.sheet .chart path').length > 0);
check('rebuilt history draws a line', (await page.locator('.sheet .chart path').count()) >= 1);
await page.screenshot({ path: `${out}/sheet-desktop.png` });
await page.keyboard.press('Escape');
check('Escape closes the sheet', (await page.locator('.sheet').count()) === 0);

// Trade lab: Warren for Emmett with Dakyard.
await tab('Trade lab');
const dak = await page.locator('#lab-team option', { hasText: 'Dakyard' }).getAttribute('value');
await page.selectOption('#lab-team', dak);
await page.fill('#search-1', 'Warren');
await page.locator('.pick-row', { hasText: 'Jaylen Warren' }).click();
const theirSearch = page.locator('.lab .panel').nth(1).locator('input.input');
await theirSearch.fill('Emmett');
await page.locator('.lab .panel').nth(1).locator('.pick-row', { hasText: 'Emmett Johnson' }).click();
const pTxt = await page.locator('.big').innerText();
check('Warren for Emmett reads as a likely no', parseInt(pTxt) < 20, pTxt);
const emmettBefore = await page.locator('main .tbl tbody tr', { hasText: 'Emmett Johnson' }).locator('td').nth(2).innerText();
check('balance suggests what to add', (await page.locator('button', { hasText: /^Add / }).count()) > 0);
await page.screenshot({ path: `${out}/lab-desktop.png`, fullPage: true });
await page.getByRole('button', { name: 'They said no' }).click();
await page.waitForSelector('.toast');
check('logging a no saves it', [...(await page.evaluate(() => [...window.__store.keys()]))].some((k) => k.startsWith('trades/m-')));
await page.waitForTimeout(200);
const emmettAfter = await page.locator('main .tbl tbody tr', { hasText: 'Emmett Johnson' }).locator('td').nth(2).innerText();
const n = (s) => +s.replace(/[^0-9]/g, '');
check("the no raises Emmett in Dakyard's eyes", n(emmettAfter) > n(emmettBefore), `${emmettBefore} → ${emmettAfter}`);

// Log
await tab('Log');
check('log lists the offer and league trades', (await page.locator('.log-row').count()) >= 10);
check('log shows the rejection', (await page.locator('.oc-rejected').count()) === 1);

// Find
await tab('Find a trade');
await page.fill('#find-q', 'Emmett');
await page.locator('main .tbl tbody tr', { hasText: 'Emmett Johnson' }).click();
const offers = await page.locator('.log-row').count();
const none = await page.locator('.empty h3', { hasText: 'Nothing clears' }).count();
check('find returns offers or says none clear', offers > 0 || none === 1, `${offers} offers`);
if (offers) check('offers open in the lab', await page.locator('.log-row button', { hasText: 'Open in lab' }).first().isVisible());

// League
await tab('League');
check('league shows ten teams', (await page.locator('.tcard').count()) === 10);
check('league shows lessons from league trades', (await page.locator('.tcard .lessons li').count()) > 0);
await page.locator('.tcard', { hasText: 'Dakyard' }).getByRole('button').click();
await page.fill('[id^="mgr-"]', 'Jake');
await page.locator('[id^="mgr-"]').blur();
await page.waitForTimeout(150);
check('manager name is saved', (await page.locator('.panel-h h2').first().innerText()).toLowerCase().includes('jake'));
await page.screenshot({ path: `${out}/board-desktop.png` });

// Data: KTC paste
await tab('Data');
await page.fill('#ktc-paste', ['1', 'Emmett Johnson', 'KC', 'RB3', '23.4 y.o.', '7,412', '2', 'Jaylen Warren', 'PIT', 'RB31', '28.1 y.o.', '3901', '2027 Early 1st 6900'].join('\n'));
check('KTC paste matches players', /Matched 2 league players/.test(await page.locator('main').innerText()));
await page.getByRole('button', { name: 'Use these values' }).click();
await page.waitForTimeout(150);
check('market override saved', JSON.stringify(await page.evaluate(() => window.__store.get('league/settings'))).includes('7412'));
await page.getByRole('button', { name: 'Go back to the model' }).click();

if (payloadFile) {
  await page.getByRole('button', { name: 'Sync from Sleeper' }).click();
  await page.waitForSelector('.toast:has-text("Synced")', { timeout: 15000 });
  check('sync reads all ten teams', /Synced 10 teams/.test(await page.locator('.toast').innerText()));
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close();

// Phone, light and dark.
for (const [file, name] of [
  [light, 'light'],
  [dark, 'dark'],
]) {
  const c = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await c.newPage();
  await p.goto('file://' + file);
  await p.waitForSelector('.teamname');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check(`phone ${name}: no sideways scroll`, sw <= 390, `${sw}px`);
  await p.screenshot({ path: `${out}/roster-phone-${name}.png` });
  await p.locator('.tab', { hasText: 'League' }).click();
  await p.screenshot({ path: `${out}/league-phone-${name}.png` });
  await p.locator('.tab', { hasText: 'My team' }).click();
  await p.locator('main .tbl tbody tr').nth(2).click();
  await p.waitForSelector('.sheet');
  await p.screenshot({ path: `${out}/sheet-phone-${name}.png` });
  await c.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
