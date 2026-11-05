// A player card's points open their breakdown: FPTS (this week) and every
// week of the By week list (a played week's points, an upcoming week's
// projection, a bye) open the stats sheet for that week, whose lines add up
// to the number tapped. Real City Boys Dynasty import, week 4 live.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

// the stats sheet as it stands: its title, total, and the points lines' sum
const sheet = () => p.evaluate(() => {
  const s = document.getElementById('statSheet'), body = document.getElementById('statBody');
  const v = (e) => +String(e.textContent).replace(/[^\d.-]/g, '');
  const lines = [...body.querySelectorAll('.ss-row:not(.tot) .v')].map(v);
  const tot = body.querySelector('.ss-row.tot .v');
  return { open: s.classList.contains('show'), title: document.getElementById('statTitle').textContent, total: tot ? v(tot) : null, sum: Math.round(lines.reduce((a, b) => a + b, 0) * 100) / 100, n: lines.length, none: (body.querySelector('.ss-none') || {}).textContent || '', head: (body.querySelector('.ss-tot') || {}).textContent || '' };
});
const close = () => p.evaluate(() => closeStatSheet());
const near = (a, b, d = 0.051) => a != null && b != null && Math.abs(a - b) < d;
// a starter of yours who has played this week, from the lineup
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(500);
const key = await p.evaluate(() => {
  const q = starterPlayers(liveSides()[0]).find((x) => isLocked(x) && pLive(x.proj, x.n, x) > 5 && /Collins/.test(x.n));
  openPlayer(pKeyOf(q));
  return pKeyOf(q);
});
await p.waitForTimeout(500);
console.log('FPTS, this week');
const fpts = await p.evaluate(() => +document.querySelector('#playerBody .pc-stat.tap .v').textContent);
ok('FPTS can be tapped (marked with ›)', await p.evaluate(() => getComputedStyle(document.querySelector('#playerBody .pc-stat.tap .l'), '::after').content.includes('›')));
await p.click('#playerBody .pc-stat.tap');
await p.waitForTimeout(400);
let s = await sheet();
ok('it opens his week 4 points breakdown', s.open && s.title === 'Week 4 stats', s.title);
ok(`its total is the FPTS shown (${fpts}), and its lines add up to it`, near(s.total, fpts) && near(s.sum, s.total, 0.02) && s.n > 1, `${s.total} / lines ${s.sum}`);
await p.locator('#statSheet').screenshot({ path: OUT + '/breakdown-fpts.png' });
await close();
ok('closing it leaves his card where it was', await p.evaluate(() => currentViewName() === 'player' && !!document.querySelector('#playerBody .pw')));

console.log('By week');
const rows = await p.evaluate(() => [...document.querySelectorAll('#playerBody .pw-row')].map((r, i) => ({ i, w: +r.querySelector('.pw-w').textContent.replace(/\D/g, ''), v: +r.querySelector('.pw-p').textContent, up: r.classList.contains('up'), bye: !!r.querySelector('.bye'), tap: r.classList.contains('tap') && !!r.querySelector('.pw-go') })));
ok(`every week of the season can be tapped (${rows.length})`, rows.length >= 10 && rows.every((r) => r.tap));
const open = async (r) => { await p.locator('#playerBody .pw-row').nth(r.i).click(); await p.waitForTimeout(400); const x = await sheet(); await close(); return x; };
// a week before this one that he scored in (he missed weeks 2 and 3)
const past = rows.find((r) => r.w < 4 && !r.up && r.v > 0);
s = await open(past);
ok(`week ${past.w} (${past.v}): its own breakdown, adding up to it`, s.title === `Week ${past.w} stats` && near(s.total, past.v) && near(s.sum, s.total, 0.02) && s.n > 1, `${s.title}: ${s.total} / lines ${s.sum}`);
const missed = rows.find((r) => r.w < 4 && !r.up && !r.bye && r.v === 0);
if (missed) { s = await open(missed); ok(`a week he did not play (week ${missed.w}): 0, no points`, near(s.total, 0) && /No points/.test(s.none), s.none); }
let all = true;
for (const r of rows.filter((x) => !x.up && !x.bye)) { const x = await open(r); if (!(x.title === `Week ${r.w} stats` && near(x.total, r.v) && near(x.sum, x.total, 0.02))) { all = false; console.log('     ', r.w, r.v, JSON.stringify(x)); } }
ok('every played week the same', all);
const ahead = rows.find((r) => r.up && !r.bye && r.w === 5);
s = await open(ahead);
ok(`next week (${ahead.v}): his projection, itemized, adding up to it`, s.title === 'Week 5 projection' && near(s.total, ahead.v) && near(s.sum, s.total, 0.02) && s.n > 1, `${s.title}: ${s.total} / lines ${s.sum}`);
const later = rows.find((r) => r.up && !r.bye && r.w >= 8);
s = await open(later);
ok(`a week Sleeper has not projected yet (${later.w}): the estimate shown, said so`, s.title === `Week ${later.w} projection` && near(s.total, later.v) && /estimate/.test(s.none), s.none);
const bye = rows.find((r) => r.bye);
if (bye) { s = await open(bye); ok(`his bye (week ${bye.w}): 0, no game`, s.title === `Week ${bye.w} · Bye` && near(s.total, 0) && /Bye week/.test(s.none), `${s.title}: ${s.none}`); }
await p.locator('#playerBody .pw').screenshot({ path: OUT + '/breakdown-weeks.png' });
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
