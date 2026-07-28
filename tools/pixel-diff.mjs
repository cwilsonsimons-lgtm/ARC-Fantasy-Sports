// Screenshot two builds through the same interaction steps and compare pixels.
// DOM snapshots prove the JS matches; this proves the stylesheet split matches.
//
// Usage: node tools/pixel-diff.mjs <url-a> <url-b>
//
// Three sources of noise have to be controlled or this reports differences that
// are not there. See the comments in shot() - all three were real false alarms.
import { chromium } from 'playwright';

const [urlA, urlB] = process.argv.slice(2);
if (!urlA || !urlB) {
  console.error('usage: node tools/pixel-diff.mjs <url-a> <url-b>');
  process.exit(1);
}

// A channel can land one unit apart when the compositor rounds a gradient or an
// anti-aliased edge. That is not a visible difference; anything above it is.
const TOLERANCE = 1;

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

async function shot(browser, url) {
  const page = await browser.newPage({ viewport: { width: 460, height: 940 } });

  // (1) Player headshots and webfonts are remote. When they are unreachable, the
  // broken-image placeholders appear whenever each request happens to fail, so
  // two runs of the *same* build disagree. Aborting up front makes that failure
  // deterministic.
  await page.route('**', r =>
    /^https?:\/\/(127\.0\.0\.1|localhost)/.test(r.request().url()) ? r.continue() : r.abort());

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(`localStorage.clear()`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // (2) The live-score dot pulses on a 1.8s loop, so its phase tracks wall-clock
  // time. (3) Toasts are setTimeout-driven and fade on their own schedule.
  await page.evaluate(`(() => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}'
      + '#hint{display:none !important}';
    document.head.appendChild(s);
  })()`);
  await page.waitForTimeout(150);

  const out = {};
  for (const [name, code] of views) {
    if (code) { await page.evaluate(code).catch(() => {}); await page.waitForTimeout(900); }
    out[name] = (await page.screenshot()).toString('base64');
  }
  await page.close();
  return out;
}

// Compare inside the browser so no PNG decoder is needed on the Node side.
async function compare(page, a, b) {
  return page.evaluate(async ([da, db, tol]) => {
    const load = src => new Promise(res => {
      const i = new Image(); i.onload = () => res(i); i.src = src;
    });
    const pixels = img => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const [ia, ib] = await Promise.all([load(da), load(db)]);
    const [pa, pb] = [pixels(ia), pixels(ib)];
    let over = 0, maxDelta = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]),
                         Math.abs(pa[i + 1] - pb[i + 1]),
                         Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > maxDelta) maxDelta = d;
      if (d > tol) over++;
    }
    return { over, maxDelta };
  }, [`data:image/png;base64,${a}`, `data:image/png;base64,${b}`, TOLERANCE]);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const a = await shot(browser, urlA);
const b = await shot(browser, urlB);

const page = await browser.newPage();
let bad = 0;
for (const [name] of views) {
  const { over, maxDelta } = await compare(page, a[name], b[name]);
  if (over) bad++;
  const note = over ? `${over} px over tolerance (max delta ${maxDelta})`
                    : `max delta ${maxDelta}`;
  console.log(`${over ? 'DIFFERS' : 'match  '}  ${name.padEnd(10)} ${note}`);
}
await browser.close();

console.log(bad ? `\n${bad}/${views.length} views differ beyond ±${TOLERANCE}`
                : `\nall ${views.length} views identical within ±${TOLERANCE}`);
process.exit(bad ? 1 : 0);
