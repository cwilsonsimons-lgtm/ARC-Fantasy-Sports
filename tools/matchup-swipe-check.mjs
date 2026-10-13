// The matchup screen: a sideways swipe steps through the week's other games,
// an old week opens on the full matchup, and the All Matchups list no longer
// shakes when it is flicked. Touches are real touch events (CDP), on a phone
// sized, touch-enabled page. Run on the demo league and on the real City Boys
// Dynasty import from fixtures/league.
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
const cdp = await ctx.newCDPSession(p);
// a finger: down, ten moves 12ms apart, up
const swipe = async (dx, dy = 0, x0 = 200, y0 = 330) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 10, y: y0 + dy * i / 10 }] }); await p.waitForTimeout(12); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(600);
};
const keyOf = (e) => [...e.classList].find((c) => c.startsWith('tf-')).slice(3);
const shown = () => p.evaluate(() => {
  const dots = [...document.querySelectorAll('#userHero .ms-dots i')];
  return {
    idx: shownGameIdx(), keys: [...document.querySelectorAll('#userHero .ms-side .sh-tn')].map((e) => [...e.classList].find((c) => c.startsWith('tf-')).slice(3)),
    score: document.querySelector('#userHero .sh-score').textContent.replace(/\s/g, ''),
    dots: dots.length, on: dots.findIndex((e) => e.classList.contains('on')),
    rows: document.querySelectorAll('#userLineup .st-row').length, edit: document.querySelectorAll('#userLineup .tapslot, #userLineup .lockslot').length,
    link: !!document.querySelector('#userLineup .activity'), view: currentViewName()
  };
});
const games = (w) => p.evaluate((w) => getGames(w === 'live' ? lvState().week : w == null ? lvState().viewWeek : w).map((g) => ({ k: [g.a, g.x].sort().join(), me: g.me, sc: g.as.toFixed(1) + '–' + g.xs.toFixed(1) })), w);
const same = (s, g) => s.keys.slice().sort().join() === g.k;

async function run(label) {
  console.log(label);
  const G = await games();
  let s = await shown();
  ok(`opens on your game, one dot per game (${s.dots}), yours lit`, s.idx === 0 && s.dots === G.length && s.on === 0 && s.edit > 0 && same(s, G[0]));
  await p.screenshot({ path: OUT + `/swipe-${label}-0.png` });
  await swipe(-160);
  s = await shown();
  ok('swipe left: the next game on the same screen, both lineups, read-only', s.idx === 1 && s.on === 1 && same(s, G[1]) && s.rows > 8 && s.edit === 0 && s.view === 'matchup', s.keys.join(' v '));
  ok('its scoreboard is that game\'s score', s.score === G[1].sc, s.score + ' / ' + G[1].sc);
  await p.screenshot({ path: OUT + `/swipe-${label}-1.png` });
  await swipe(-160);
  ok('swipe left again: the game after', (await shown()).idx === 2);
  await swipe(160); await swipe(160);
  s = await shown();
  ok('swipe right twice: back to your game, editable again', s.idx === 0 && s.edit > 0);
  await swipe(160);
  ok('swipe right from yours wraps round to the last game', (await shown()).idx === G.length - 1);
  await swipe(160);
  await swipe(-40);
  ok('a short drag snaps back', (await shown()).idx === G.length - 2);
  await swipe(-30, -220, 200, 600);
  ok('a mostly vertical drag scrolls, it does not change games', (await shown()).idx === G.length - 2);
  await p.waitForTimeout(800);
  await p.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
  await p.waitForTimeout(200);
  await p.locator('#userHero .ms-dots i').nth(2).click();
  ok('tapping a dot goes to that game', (await shown()).idx === 2, JSON.stringify(await shown()));
  // the chart is its own: a drag on it scrubs
  await p.evaluate(() => toggleRewind('userRewind'));
  await p.waitForTimeout(300);
  const rb = await p.evaluate(() => { const r = document.querySelector('#userRewind .rw-svg').getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height / 2 }; });
  await swipe(-150, 0, rb.x, rb.y);
  ok('a drag on the chart scrubs it instead', (await shown()).idx === 2 && await p.evaluate(() => !!document.querySelector('#userLineup .rw-at')));
  await p.evaluate(() => { toggleRewind('userRewind'); document.getElementById('scroll').scrollTop = 0; showTab('team'); showTab('matchup'); });
  ok('the Matchup tab is always your game', (await shown()).idx === 0);
  // an old week
  await swipe(-160);
  await p.evaluate(() => stepWeek(-1));
  await p.waitForTimeout(400);
  const G3 = await games(), now = await games('live');
  s = await shown();
  ok('a new week goes back to your game', s.idx === 0);
  ok('an old week shows the full matchup without a tap', !s.link && s.rows > 8 && s.edit === 0, `${s.rows} rows`);
  ok('against that week\'s opponent, with that week\'s score', same(s, G3[0]) && G3[0].k !== now[0].k && s.score === G3[0].sc, s.keys.join(' v ') + ' ' + s.score);
  const line = await p.evaluate(() => [...document.querySelectorAll('#userLineup .g2.sl')].map((e) => e.textContent));
  ok('each player shows his stat line', line.length > 8 && line.every((t) => /\d|No stats/.test(t)), line[0]);
  await p.screenshot({ path: OUT + `/swipe-${label}-week3.png` });
  await p.evaluate(() => toggleRewind('userRewind'));
  await p.waitForTimeout(300);
  const rw = await p.evaluate(() => document.querySelector('#userRewind').innerText.replace(/\s/g, ''));
  ok('its chart is that game\'s, ending on its final score', rw.includes(s.score), s.score + ' / ' + rw);
  await p.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
  await p.waitForTimeout(300);
    await swipe(-160, 0, 200, 230);
  s = await shown();
  ok('the swipe works in old weeks too', s.idx === 1 && same(s, G3[1]) && s.score === G3[1].sc, JSON.stringify([s.idx, s.keys, s.score, G3[1]]));
  await p.evaluate(() => { toggleRewind('userRewind'); stepWeek(2); });
  s = await shown();
  ok('a future week shows the full matchup too', !s.link && s.rows > 8, `${s.rows} rows`);
  await p.evaluate(() => { stepWeek(-1); document.getElementById('scroll').scrollTop = 0; });
}

// the demo league, drafted
await p.evaluate(() => { openLeague('cbd'); autoDraftAll(); showTab('matchup'); liveRefresh(true); });
await p.waitForTimeout(2500);
await run('demo');

// All Matchups, flicked the way a phone does: the finger leaves and the list
// glides on, slowing each frame
await p.evaluate(() => showLeagueView());
await p.waitForTimeout(600);
const flick = () => p.evaluate(() => new Promise((done) => {
  const sc = document.getElementById('scroll'), sh = document.querySelector('.shift');
  let v = 25, f = 0, folds = 0, was = sh.classList.contains('chrome-hide');
  const tick = () => {
    if (v > 0.5) { sc.scrollTop += v; v *= 0.95; }
    const now = sh.classList.contains('chrome-hide');
    if (now !== was) folds++;
    was = now;
    if (++f < 150) requestAnimationFrame(tick); else done({ folds, range: sc.scrollHeight - sc.clientHeight });
  };
  requestAnimationFrame(tick);
}));
for (const h of [844, 760, 980]) {
  await p.setViewportSize({ width: 390, height: h });
  await p.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
  await p.waitForTimeout(600);
  const f = await flick();
  ok(`All Matchups at ${h}px tall: a flick folds the header at most once, no shaking`, f.folds <= 1, `${f.folds} folds, ${f.range}px to scroll`);
}
await p.setViewportSize({ width: 390, height: 844 });

// the real league, imported from Sleeper
await p.evaluate(() => { goHome(); });
// tapped the way a finger does: Playwright's click scrolls the element into
// view, and while the sheet is still sliding up that scrolls the app's frame
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
ok('the frame itself never scrolled', await p.evaluate(() => document.querySelector('.phone').scrollTop === 0));
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); document.getElementById('scroll').scrollTop = 0; });
await run('sleeper');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
