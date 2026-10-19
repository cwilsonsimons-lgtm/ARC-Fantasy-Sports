// Win odds on the real City Boys Dynasty import. Sleeper's projections carry
// first downs at a tenth of the yards (about 2.4 times the real rate), which
// in a league that scores first downs ran every projection high; the app
// puts in the real rate. The odds spread is the one real lineups showed, and
// no side is shown at 100% or 0% while there is still football to play.
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

console.log('projections');
const proj = JSON.parse(fs.readFileSync(R + 'live/proj_4.json'));
const stats = JSON.parse(fs.readFileSync(R + 'live/stats_4.json'));
const fd = proj.filter((r) => (r.stats.rec_yd || 0) > 40 || (r.stats.rush_yd || 0) > 40);
ok(`Sleeper's own rows: first downs are a tenth of the yards (${fd.length} players)`, fd.length > 50 && fd.every((r) => Math.abs((r.stats.rec_fd || 0) - (r.stats.rec_yd || 0) / 10) < 0.02 && Math.abs((r.stats.rush_fd || 0) - (r.stats.rush_yd || 0) / 10) < 0.02));
const got = await p.evaluate((rows) => rows.map((r) => {
  const id = LIVE.sid[r.player_id], line = id && LIVE.proj[4][id];
  return line ? { yd: line.recYd || 0, fd: line.recFD || 0, ry: line.rushYd || 0, rfd: line.rushFD || 0, py: line.passYd || 0, pfd: line.passFD || 0 } : null;
}).filter(Boolean), fd);
const near = (a, b) => Math.abs(a - b) < 0.02;
ok(`the app's projections carry the real rates (${got.length} players)`, got.length > 50 && got.every((q) => near(q.fd, q.yd * 0.041) && near(q.rfd, q.ry * 0.052) && near(q.pfd, q.py * 0.041)));
const qb = got.find((q) => q.py > 150);
ok('a quarterback\'s passing first downs too', !!qb && qb.pfd > 0 && qb.pfd < qb.py / 20, qb && `${qb.py} yd, ${qb.pfd} first downs`);
const st = stats.filter((r) => r.stats.rec_fd > 0).slice(0, 30);
const real = await p.evaluate((rows) => rows.map((r) => { const id = LIVE.sid[r.player_id], l = id && LIVE.stats[4][id]; return l ? [l.recFD, r.stats.rec_fd] : null; }).filter(Boolean), st);
ok(`real stat lines keep their own first downs (${real.length})`, real.length > 10 && real.every(([a, b]) => a === b));
// a receiver's projection in this league: yards, catches by length, first downs
const wr = await p.evaluate(() => {
  const r = Object.keys(LIVE.proj[4]).map((id) => [id, LIVE.proj[4][id]]).find(([id, l]) => (NFL_BY_ID[id] || {}).pos === 'WR' && l.recYd > 70);
  return r && { n: NFL_BY_ID[r[0]].n, pts: lvProj(r[0], 4), yd: r[1].recYd, fd: r[1].recFD };
});
ok('a receiver\'s projection counts about one first down per 24 yards', !!wr && wr.fd < wr.yd / 20, wr && `${wr.n}: ${wr.yd} yd, ${wr.fd} first downs, ${wr.pts} pts`);
const teams = await p.evaluate(() => getGames(4).map((g) => [g.a, g.x]).flat().map((k) => rosterOf(k).starters.reduce((n, s) => n + (s.player ? +s.player.proj || 0 : 0), 0)));
const avg = teams.reduce((a, b) => a + b, 0) / teams.length;
ok('a lineup is projected near what lineups score in this league (130-175)', avg > 130 && avg < 175, avg.toFixed(1));

console.log('odds');
const wp = await p.evaluate(() => [[0, 0], [35, 333], [20, 180], [60, 40], [-60, 40], [0.5, 0], [-0.5, 0], [200, 4]].map(([e, r]) => winProbability(e, r)));
ok('a 35-point projected edge before kickoff is about 4 in 5', wp[1] >= 78 && wp[1] <= 84, wp[1] + '%');
ok('20 ahead with 180 still to play: about 3 in 4', wp[2] >= 70 && wp[2] <= 78, wp[2] + '%');
ok('a big lead with a game left stays below 100, a big deficit above 0', wp[3] === 99 && wp[4] === 1 && wp[7] === 99);
ok('when it is over: 100 or 0 (50 for a tie)', wp[0] === 50 && wp[5] === 100 && wp[6] === 0);
const g = await p.evaluate(() => getGames(4).map((x) => ({ aw: x.aw, xw: x.xw, me: x.me })));
ok(`live matchups all between 1 and 99 and add to 100 (${g.map((x) => x.aw).join(' ')})`, g.length === 5 && g.every((x) => x.aw >= 1 && x.aw <= 99 && x.aw + x.xw === 100));
const card = await p.evaluate(() => { showTab('matchup'); return document.querySelector('#userHero').innerText; });
const mine = g.find((x) => x.me);
ok('your matchup card shows those odds', card.includes(mine.aw + '%') || card.includes(mine.xw + '%'), mine.aw + '-' + mine.xw);
await p.screenshot({ path: OUT + '/win-odds.png', clip: { x: 0, y: 0, width: 390, height: 420 } });
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
