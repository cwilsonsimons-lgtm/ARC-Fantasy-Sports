// Screenshot the single-file prototype across its main surfaces.
//
// The prototype is one self-contained HTML file, so this loads it over file://
// and drives it with the same global handlers the markup uses. External requests
// (headshots, anything not file://) are aborted so a run looks the same offline.
//
// Usage: node tools/shots.mjs <path-to-html> <out-dir> [step,step,...]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [target, outDir, only] = process.argv.slice(2);
if (!target || !outDir) {
  console.error('usage: node tools/shots.mjs <path-to-html> <out-dir> [step,...]');
  process.exit(1);
}

// Each step: a name plus code run in the page. They run in order against one
// page, so a step sees the state the previous ones left behind.
const steps = [
  ['00-home', null],
  ['01-open-league', `openLeague(orderedLeagues()[0].id)`],
  ['02-matchup', `showTab('matchup')`],
  ['03-team', `showTab('team')`],
  ['04-league', `showTab('standings')`],
  ['05-drawer', `toggleDrawer()`],
  ['06-drawer-close', `toggleDrawer()`],
  ['07-markets', `openMarkets()`],
  ['08-markets-close', `closeMarkets()`],
  ['09-chat', `openChat()`],
  ['10-notifs', `backFromChat();openNotifs()`],
  ['11-create', `goHome();openCreateLeague()`],
];

const wanted = only ? new Set(only.split(',')) : null;
await mkdir(outDir, { recursive: true });

// Chromium ships with the container in this environment; fall back to whatever
// Playwright resolves on its own elsewhere.
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + target, { waitUntil: 'load' });
await page.waitForTimeout(600);

for (const [name, code] of steps) {
  if (code) {
    try { await page.evaluate(code); } catch (e) { console.log('step failed:', name, String(e).slice(0, 200)); }
  }
  await page.waitForTimeout(350);
  if (!wanted || wanted.has(name)) await page.screenshot({ path: `${outDir}/${name}.png` });
}

console.log(errors.length ? `page errors:\n${errors.slice(0, 5).join('\n')}` : 'no page errors');
await browser.close();
