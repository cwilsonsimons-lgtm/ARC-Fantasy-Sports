// Screenshot two builds through the same interaction steps and compare pixels.
// DOM snapshots prove the JS matches; this proves the stylesheet split matches.
// Usage: node tools/pixel-diff.mjs <url-a> <url-b>
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const [urlA, urlB] = process.argv.slice(2);

const views = [
  ['boot', null],
  ['draft', `showTab('draft')`],
  ['autodraft', `autoDraftAll()`],
  ['matchup', `showTab('matchup')`],
  ['league', `showLeagueView()`],
  ['standings', `showTab('standings')`],
  ['team', `showTab('team')`],
  ['drawer', `toggleDrawer()`],
  ['settings', `toggleDrawer();openSettings()`],
  ['scoring', `setSetTab('scoring')`],
];

async function shots(url) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 460, height: 940 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(`localStorage.clear()`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3400);   // let the boot toast appear and expire

  // The live-score dot pulses on a 1.8s loop, so its phase depends on wall-clock
  // time and every screenshot containing it would differ at random. Freeze all
  // animation and transition so the comparison only sees layout and colour.
  await page.evaluate(`(() => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}'
      + '#hint{display:none !important}';   // toasts are timer-driven, so hide them
    document.head.appendChild(s);
  })()`);
  await page.waitForTimeout(150);

  const out = {};
  for (const [name, code] of views) {
    if (code) { await page.evaluate(code).catch(() => {}); await page.waitForTimeout(800); }
    const buf = await page.screenshot({ fullPage: false });
    out[name] = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }
  await browser.close();
  return out;
}

const [a, b] = [await shots(urlA), await shots(urlB)];
let bad = 0;
for (const [name] of views) {
  const same = a[name] === b[name];
  if (!same) bad++;
  console.log(`${same ? 'match  ' : 'DIFFERS'}  ${name}`);
}
console.log(bad ? `\n${bad}/${views.length} views differ` : `\nall ${views.length} views render identically`);
process.exit(bad ? 1 : 0);
