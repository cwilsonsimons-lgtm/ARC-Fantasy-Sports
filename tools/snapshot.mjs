// Drives the app through every view and dumps DOM snapshots.
// Used to prove the modular build renders identically to the original single file.
// Usage: node tools/snapshot.mjs <url> <out-dir>
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node tools/snapshot.mjs <url> <out-dir>');
  process.exit(1);
}

// Each step: a name plus code run in the page. Steps run in order against one
// page instance, so later steps see the state left by earlier ones.
const steps = [
  ['00-boot', null],
  ['01-draft-tab', `showTab('draft')`],
  ['02-draft-pos-rb', `setDraftPos('RB')`],
  ['03-draft-search', `onDraftSearch('ja')`],
  ['03b-draft-search-clear', `clearDraftSearch()`],
  ['04-draft-sim', `simToMyPick()`],
  ['05-autodraft', `autoDraftAll()`],
  ['06-matchup', `showTab('matchup')`],
  ['07-week-next', `stepWeek(1)`],
  ['08-week-prev', `stepWeek(-1)`],
  ['09-week-pick-5', `pickWeek(5)`],
  ['10-league-view', `showLeagueView()`],
  ['11-detail', `(()=>{const c=document.querySelector('[onclick*="openDetail"]');if(c)c.click();})()`],
  ['12-standings', `showTab('standings')`],
  ['13-team', `showTab('team')`],
  ['14-open-team', `openTeam('barzal')`],
  ['15-player', `(()=>{const p=document.querySelector('[onclick*="openPlayer"]');if(p)p.click();})()`],
  ['16-drawer', `toggleDrawer()`],
  ['17-rail-leaders', `selectRail('leaders')`],
  ['18-leader-pos', `setLeaderPos('WR')`],
  ['19-leader-metric', `setLeaderMetric('season')`],
  ['20-rail-trending', `selectRail('trending')`],
  ['21-trend-pos', `setTrendPos('QB')`],
  ['22-rail-available', `selectRail('available')`],
  ['23-avail-pos', `setAvailPos('TE')`],
  ['24-settings', `openSettings()`],
  ['25-set-roster', `setSetTab('roster')`],
  ['26-set-scoring', `setSetTab('scoring')`],
  ['27-set-matchups', `setSetTab('matchups')`],
  ['28-sim-step', `showTab('matchup');stepSim(1)`],
  ['29-sim-step2', `stepSim(1)`],
  ['30-rewind', `toggleRewind()`],
];

// innerHTML of blob:/data: image sources and file inputs is stable here, but
// element ordering inside <style> injected at runtime is not worth diffing.
// Drop <style> and <script> nodes: the original carries its CSS and JS inline in
// the document, the split build links them, and that difference is the point of
// the refactor rather than something to diff.
const capture = `(()=>{
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('style,script').forEach(s=>s.remove());
  const mk = clone.querySelector('#mk'); if (mk) mk.remove();  // Arc Markets is a separate surface
  // the draft clock counts real seconds, so its text differs between runs
  const clk = clone.querySelector('#dgTimer'); if (clk) clk.textContent = 'CLOCK';
  return document.body.className + '\\n' + clone.innerHTML;
})()`;

// The environment ships a pinned Chromium; use it rather than downloading one.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 500, height: 1000 } });

const errors = [];
// Fonts and player headshots are remote; in a sandbox they always fail to load.
// Those are not defects in the code under test, so drop them.
const isNetworkNoise = t => /Failed to load resource|ERR_|net::/.test(t);
page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
page.on('console', m => {
  if (m.type() === 'error' && !isNetworkNoise(m.text())) errors.push('console: ' + m.text());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(`localStorage.clear()`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200); // let the boot toast timer settle

await mkdir(outDir, { recursive: true });

for (const [name, code] of steps) {
  if (code) {
    try {
      await page.evaluate(code);
    } catch (e) {
      errors.push(`step ${name}: ${e.message}`);
    }
    await page.waitForTimeout(120);
  }
  const html = await page.evaluate(capture);
  await writeFile(`${outDir}/${name}.txt`, html);
}

await writeFile(`${outDir}/_errors.txt`, errors.join('\n'));
await browser.close();

console.log(`${steps.length} snapshots -> ${outDir}`);
if (errors.length) {
  console.log(`\n!! ${errors.length} page errors:`);
  console.log(errors.slice(0, 20).join('\n'));
} else {
  console.log('no page errors');
}
