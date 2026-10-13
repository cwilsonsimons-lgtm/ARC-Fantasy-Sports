// A finished week saved mid-game corrects itself. If the app was last opened
// while a week was being played, Sleeper's points for that week (players and
// teams) and ESPN's touchdowns were saved as they stood then; the box score is
// fetched fresh, so the stats sheet showed the gap as "Other scoring". Here the
// imported City Boys league has week 3 rolled back to a mid-game state (every
// point halved, no touchdowns, games under way), the page reloads in week 4,
// and week 3 must come back whole, without being pulled again afterwards.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [], hits = {};
p.on('pageerror', e => errs.push(String(e)));
const hit = (k) => hits[k] = (hits[k] || 0) + 1;
const file = (r, f) => r.fulfill({ status: 200, contentType: 'application/json', body: f && fs.existsSync(f) ? fs.readFileSync(f) : '[]', headers: { 'access-control-allow-origin': '*' } });
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    const m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== '1312045587541020672') return r.fulfill({ status: 404, body: 'null' });
    if (m[2] === 'matchups') hit('matchups:' + m[3]);
    return file(r, R + 'league/' + (!m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json'));
  }
  if (u.hostname === 'api.sleeper.com') {
    const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/);
    if (m) hit(m[1] + ':' + m[2]);
    return file(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json');
  }
  if (u.hostname === 'site.api.espn.com') {
    const sb = u.pathname.endsWith('/scoreboard');
    hit(sb ? 'board:' + u.searchParams.get('week') : 'summary');
    return file(r, R + 'live/' + (sb ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  }
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
const URL_ = 'file://' + new URL('../1stPrototype.html', import.meta.url).pathname;
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const MATCHUPS_3 = JSON.parse(fs.readFileSync(R + 'league/matchups_3.json'));

// import, then week 3 as it really ended
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); pickWeek(3); });
await p.waitForTimeout(2000);
// the first starter with a touchdown that week: his stats sheet, as it should read
const pick = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#userLineup .st-row')];
  for (let i = 0; i < rows.length; i++) {
    const sides = rows[i].querySelectorAll('.st-side');
    for (let j = 0; j < 2; j++) if (/\bTD\b/.test(sides[j].textContent)) return { i, j };
  }
  return null;
});
const sheet = async () => {
  await p.locator('#userLineup .st-row').nth(pick.i).locator('.st-pts').nth(pick.j).click();
  await p.waitForTimeout(250);
  const s = await p.evaluate(() => {
    const el = document.getElementById('statSheet'), num = (t) => parseFloat(String(t).replace(/[^\d.-]/g, ''));
    const other = [...el.querySelectorAll('.ss-row.other .v')].map((v) => num(v.textContent));
    return { name: el.querySelector('.ss-n').textContent, total: num(el.querySelector('.ss-row.tot .v').textContent), other: other.length ? other[0] : 0, tds: el.querySelectorAll('.ss-td:not(.two)').length };
  });
  await p.evaluate(() => closeStatSheet());
  return s;
};
const truth = await sheet();
const score = () => p.evaluate(() => document.querySelector('#userHero .sh-score').textContent.replace(/\s/g, ''));
const truthScore = await score();
const mine = MATCHUPS_3.find((m) => m.roster_id === 1);
console.log(`   ${truth.name}, week 3: ${truth.total} points, ${truth.tds} TD, other ${truth.other}; matchup ${truthScore}`);
ok('the reference player has a touchdown and no unexplained points', pick && truth.tds > 0 && Math.abs(truth.other) < 0.5);

// roll week 3 back to a mid-game save, the way it is left when the app was
// last opened during the games: Sleeper's points (store, saved to the account)
// and ESPN's board and plays (the live cache)
await p.evaluate(() => {
  const rec = myLeagues().find((l) => l.sleeper);
  Object.values(rec.sleeper.pts[3]).forEach((t) => {
    t.p = Math.round(t.p * 50) / 100;
    Object.keys(t.pp).forEach((sid) => t.pp[sid] = Math.round(t.pp[sid] * 50) / 100);
  });
  delete rec.sleeper.ptsDone;
  saveStore();
  const c = JSON.parse(localStorage.getItem('arc_live_v2'));
  Object.keys(c.plays[3] || {}).forEach((tm) => c.plays[3][tm] = []);
  Object.values(c.games[3] || {}).forEach((g) => { g.state = 'in'; g.sc = '0-0'; });
  delete c.sig;
  localStorage.setItem('arc_live_v2', JSON.stringify(c));
});
Object.keys(hits).forEach((k) => delete hits[k]);
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const stale = await p.evaluate(() => { const rec = myLeagues().find((l) => l.sleeper); return rec.sleeper.pts[3].s1.p; });
ok('the reloaded page starts from the mid-game save', Math.abs(stale - Math.round(mine.points * 50) / 100) < 0.01, `my week 3 saved as ${stale}`);
await p.evaluate(() => { openLeague(myLeagues().find((l) => l.sleeper).id); });
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); pickWeek(3); });
await p.waitForTimeout(2000);
const fixed = await p.evaluate(() => { const rec = myLeagues().find((l) => l.sleeper); return { p: rec.sleeper.pts[3].s1.p, done: rec.sleeper.ptsDone }; });
ok('week 3\'s Sleeper points were pulled again, and marked final', Math.abs(fixed.p - Math.round(mine.points * 100) / 100) < 0.01 && fixed.done[3] === 1 && fixed.done[1] === 1 && !fixed.done[4], `${fixed.p} (Sleeper ${mine.points}), final ${JSON.stringify(fixed.done)}`);
ok('the matchup score is the real one again', (await score()) === truthScore, await score());
const after = await sheet();
ok('the stats sheet total is Sleeper\'s final number', Math.abs(after.total - truth.total) < 0.01, `${after.total}`);
ok('no "other scoring" left over beyond what was there', Math.abs(after.other - truth.other) < 0.01, `${after.other}`);
ok('every touchdown is listed again', after.tds === truth.tds, `${after.tds} TD`);
ok('last week\'s stats were fetched again this session', hits['stats:3'] === 1, `stats:3 x${hits['stats:3'] || 0}`);
await p.screenshot({ path: OUT + '/stale-week-fixed.png' });
// and then it stays put
const before = Object.assign({}, hits);
await p.evaluate(() => liveRefresh(true));
await p.waitForTimeout(1500);
await p.evaluate(() => { pickWeek(4); pickWeek(3); });
await p.waitForTimeout(1500);
const again = (k) => (hits[k] || 0) - (before[k] || 0);
ok('a later refresh pulls only the live week from Sleeper', again('matchups:4') === 1 && again('matchups:3') === 0 && again('matchups:2') === 0, JSON.stringify({ m4: again('matchups:4'), m3: again('matchups:3') }));
ok('and no finished game\'s plays or board again', again('summary') === 0 && again('board:3') === 0 && again('stats:3') === 0, JSON.stringify({ summary: again('summary'), board3: again('board:3'), stats3: again('stats:3') }));
// the six-hourly full sync takes last week again, for stat corrections
await p.evaluate(() => { myLeagues().find((l) => l.sleeper).sleeper.at = 1; });
const b2 = hits['matchups:3'] || 0;
await p.evaluate(() => liveRefresh(true));
await p.waitForTimeout(1500);
ok('a full sync pulls last week again (stat corrections)', (hits['matchups:3'] || 0) - b2 === 1 && !hits['matchups:2:again']);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
