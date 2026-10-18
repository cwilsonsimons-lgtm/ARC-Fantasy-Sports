// The side menu's Leaders panel opens on this season's top scorers: real
// points under the league's scoring, not projections, every time the menu
// opens on it or it is picked from the rail. Runs on the real City Boys
// Dynasty import (fixtures/league), week 4 live.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
const file = (r, f) => r.fulfill({ status: 200, contentType: 'application/json', body: f && fs.existsSync(f) ? fs.readFileSync(f) : '[]', headers: { 'access-control-allow-origin': '*' } });
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    const m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== '1312045587541020672') return r.fulfill({ status: 404, body: 'null' });
    return file(r, R + 'league/' + (!m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json'));
  }
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return file(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'); }
  if (u.hostname === 'site.api.espn.com') return file(r, R + 'live/' + (u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

// the panel as shown: its two choices and the list
const panel = () => p.evaluate(() => {
  const sel = [...document.querySelectorAll('#panel .panel-hd select')].map((s) => s.options[s.selectedIndex].textContent);
  const rows = [...document.querySelectorAll('#panel .ld-row')].map((r) => ({ n: r.querySelector('.ld-nm').textContent, v: r.querySelector('.ld-pt').textContent }));
  return { open: document.body.classList.contains('open'), sel, rows };
});
// this season's points for everyone, as the league scores them (weeks 3 and 4 have stats here)
const truth = () => p.evaluate(() => {
  const out = {};
  POOL.forEach((q) => {
    let t = 0;
    for (let w = 1; w <= lvState().week; w++) t += pLive(0, q.full || q.n, q, w) || 0;
    out[q.full] = Math.round(t * 10) / 10;
  });
  return out;
});
const menu = () => p.evaluate(() => document.querySelector('.burger').click());

await p.evaluate(() => showTab('team'));
await menu();
await p.waitForTimeout(500);
let s = await panel();
const pts = await truth();
const top = Object.entries(pts).sort((a, b) => b[1] - a[1]);
ok('the side menu opens on Leaders: Points, 2026 Season', s.open && s.sel.join() === 'Points,2026 Season', s.sel.join(' · '));
ok('the list is this season\'s top scorers, highest first, with their real points', s.rows.length >= 20 && s.rows.every((r, i) => !i || +r.v <= +s.rows[i - 1].v) && s.rows.slice(0, 10).every((r) => Math.abs(+r.v - pts[r.n]) < 0.06) && s.rows[0].n === top[0][0], s.rows.slice(0, 3).map((r) => `${r.n} ${r.v}`).join(', '));
await p.screenshot({ path: OUT + '/leaders.png' });
// projections are still a choice, but not where it opens
await p.evaluate(() => { const sel = document.querySelectorAll('#panel .panel-hd select')[0]; sel.value = 'proj'; sel.dispatchEvent(new Event('change')); });
await p.waitForTimeout(200);
s = await panel();
ok('Proj is still there to pick', s.sel[0] === 'Proj', s.sel.join(' · '));
await menu();
await p.waitForTimeout(400);
await menu();
await p.waitForTimeout(400);
s = await panel();
ok('closing and opening the menu goes back to this season\'s points', s.sel.join() === 'Points,2026 Season' && s.rows[0].n === top[0][0], s.sel.join(' · '));
// a week, then another rail, then Leaders again
await p.evaluate(() => { const sel = document.querySelectorAll('#panel .panel-hd select')[1]; sel.value = 'w3'; sel.dispatchEvent(new Event('change')); });
await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('#rail [data-rail="available"]').click());
await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('#rail [data-rail="leaders"]').click());
await p.waitForTimeout(300);
s = await panel();
ok('tapping Leaders in the rail does too', s.sel.join() === 'Points,2026 Season', s.sel.join(' · '));
// another rail stays where it was when the menu reopens
await p.evaluate(() => document.querySelector('#rail [data-rail="available"]').click());
await menu();
await p.waitForTimeout(400);
await menu();
await p.waitForTimeout(400);
ok('a different panel stays the one that opens', await p.evaluate(() => document.querySelector('#rail .rail-item.on').dataset.rail) === 'available');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
