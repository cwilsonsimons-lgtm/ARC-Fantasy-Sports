// The win-probability chart zooms: the time at its top left opens a menu of
// kickoff slots (the noon games run from noon until the late games kick off
// at 3:05), a pinch
// picks any stretch, and the chart, its scrub, the lineup beside it and a
// summary of the stretch all agree with the whole-week chart. Runs on the real
// City Boys Dynasty import (fixtures/league), week 3 finished and week 4 live
// at 2:22 PM Central, with real two-finger touches (CDP).
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

await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); pickWeek(3); toggleRewind('userRewind'); });
await p.waitForTimeout(600);

// what the chart shows, read off the page: the zoom menu's choices (the one
// in force starred) and the stretch each covers, whether the menu is open,
// the axis, the readout, the summary, and where the line's points sit
const chart = (id = 'userRewind') => p.evaluate((id) => {
  const el = document.getElementById(id), txt = (s) => { const e = el.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
  const xs = el.querySelector('.rw-line').getAttribute('points').split(' ').map((q) => +q.split(',')[0]);
  return {
    chips: [...el.querySelectorAll('.rw-mi')].map((c) => c.querySelector('.l').textContent + (c.classList.contains('on') ? '*' : '')),
    ranges: [...el.querySelectorAll('.rw-mi .r')].map((r) => r.textContent),
    menu: (() => { const m = el.querySelector('.rw-menu'); return !!m && getComputedStyle(m).display !== 'none'; })(),
    axis: [...el.querySelectorAll('.rw-axis span')].map((s) => s.textContent),
    read: [txt('.rw-read .t'), txt('.rw-read .sc'), txt('.rw-read .w')].join(' '), time: txt('.rw-read .t'), sum: txt('.rw-sum'), xs,
    pins: el.querySelectorAll('.rw-pin').length, kos: [...el.querySelectorAll('.rw-ko')].map((k) => parseFloat(k.style.left)),
    lineup: (document.querySelector('#userLineup .rw-at') || {}).textContent || null
  };
}, id);
// a choice is made the way a finger makes it: tap the time, then the choice
const tapTime = (id = 'userRewind') => p.evaluate((id) => document.querySelector('#' + id + ' .rw-when').click(), id);
const tap = async (label, id = 'userRewind') => {
  await tapTime(id);
  await p.evaluate(([label, id]) => [...document.querySelectorAll('#' + id + ' .rw-mi')].find((c) => c.querySelector('.l').textContent === label).click(), [label, id]);
};
// "SUN 3:05 PM" -> minutes past midnight Central, for comparing times on the page
const mins = (t) => { const m = t.match(/(\d+):(\d\d) (AM|PM)/); return (+m[1] % 12 + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2]; };
// a chart minute (Eastern, the app's clock) as the Central time it shows
const clock = (abs) => { const m = ((Math.round(abs) - 60) % 1440 + 1440) % 1440; return (Math.floor(m / 60) % 12 || 12) + ':' + String(m % 60).padStart(2, '0'); };
// the series behind it, straight from the app, for the same game
const series = (zoom) => p.evaluate((zoom) => { const g = getGames(lvState().viewWeek)[shownGameIdx()]; return rewindSeries([g.a, g.x], zoom).map((q) => ({ abs: q.abs, a: q.a, x: q.x, win: q.win, ko: !!q.ko, ev: q.ev.length })); }, zoom);

console.log('week 3, finished');
let c = await chart();
ok('the menu is closed to start with', !c.menu);
await tapTime();
c = await chart();
ok('tapping the time opens it: the whole week, then each slot one of these starters kicked off in', c.menu && c.chips.join() === 'Whole week*,12PM,3:05PM,SNF,MNF', c.chips.join(' '));
ok('each with the stretch it covers', c.ranges.join() === 'THU 7:15PM\u2013MON 10:35PM,SUN 12PM\u20133:05PM,SUN 3:05PM\u20136:45PM,SUN 7:20PM\u201310:40PM,MON 7:15PM\u201310:35PM', c.ranges.join(' | '));
await p.screenshot({ path: OUT + '/zoom-menu.png' });
await p.evaluate(() => document.querySelector('#userHero').click());
ok('a tap anywhere else closes it', !(await chart()).menu);
await tapTime();
await tapTime();
ok('so does the time again', !(await chart()).menu);
// the noon games kick off at 1:00 Eastern, the clock the app's minutes run on
const full = await series(), noonAbs = full.find((q) => q.ko && q.abs % 1440 === 13 * 60).abs;
await p.screenshot({ path: OUT + '/zoom-week.png' });
await tap('12PM');
await p.waitForTimeout(300);
c = await chart();
const noon = await series({ from: noonAbs, to: noonAbs + 185 });
ok('12PM zooms to the noon games: noon until 3:05, when the late games kick off; the menu closes', noon[0].abs === noonAbs && noon[noon.length - 1].abs === noonAbs + 185 && c.chips.join() === 'Whole week,12PM*,3:05PM,SNF,MNF' && !c.menu, `${noon.length} points`);
ok('the time says the chart is zoomed', await p.evaluate(() => document.querySelector('#userRewind .rw-when').classList.contains('zoomed')));
ok('the axis reads the clock across it', c.axis.join() === '12PM,1PM,2PM,3PM', c.axis.join(' '));
ok('the cursor lands on the end of it, and the lineup follows', c.time === 'SUN 3:05 PM' && c.lineup === 'SUN 3:05 PM', c.read + ' / ' + c.lineup);
ok('drawn on a time scale, edge to edge', c.xs[0] === 4 && c.xs[c.xs.length - 1] === 316 && c.xs.every((x, i) => !i || x > c.xs[i - 1]));
// the same minutes give the same numbers zoomed in or not
const at = new Map(full.map((q) => [q.abs, q]));
const shared = noon.filter((q) => at.has(q.abs));
ok('every minute it shares with the whole-week chart has the same score and odds', shared.length >= 18 && shared.every((q) => { const f = at.get(q.abs); return f.a === q.a && f.x === q.x && f.win === q.win; }), `${shared.length} shared`);
const tdsIn = full.filter((q) => q.abs >= noonAbs && q.abs <= noonAbs + 185).reduce((n, q) => n + q.ev, 0);
ok('it holds the touchdowns scored in that window, no others', noon.reduce((n, q) => n + q.ev, 0) === tdsIn && tdsIn > 0, `${tdsIn} plays`);
ok('the noon kickoff is marked; the 3:05 one belongs to the next slot', c.kos.length === 1 && c.kos[0] < 3 && !noon[noon.length - 1].ko);
const s0 = noon[0], s1 = noon[noon.length - 1], sg = (v) => (v < 0 ? '−' : '+') + Math.abs(Math.round(v * 10) / 10).toFixed(1);
ok('a summary of the window: points each side scored in it, odds at either end', c.sum === `SUN 12PM–3:05PM ${sg(s1.a - s0.a)} – ${sg(s1.x - s0.x)} ${s0.win}% → ${s1.win}%`, c.sum);
await p.screenshot({ path: OUT + '/zoom-noon.png' });
// scrub inside it
const box = await p.evaluate(() => { const r = document.querySelector('#userRewind .rw-svg').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
const touch = async (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.w * 0.2, y: box.y, id: 0 }] });
for (let i = 1; i <= 6; i++) await touch([[box.x + box.w * (0.2 + i * 0.05), box.y]]);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
c = await chart();
ok('a drag scrubs inside the window, the lineup with it', mins(c.time) > 12 * 60 + 60 && mins(c.time) < 14 * 60 + 30 && c.lineup === c.time, c.time);

// the late games
await tap('3:05PM');
await p.waitForTimeout(300);
c = await chart();
const late = await series({ from: noonAbs + 185, to: noonAbs + 440 });
ok('3:05PM: the late games, from 3:05 to when they end', late[0].abs === noonAbs + 185 && c.axis.join() === '4PM,5PM,6PM' && c.time === 'SUN 6:45 PM', c.axis.join(' ') + ' / ' + c.time);

// another game this week keeps the zoom
await p.evaluate(() => showGameAt(1));
await p.waitForTimeout(400);
c = await chart();
ok('swiping to another game keeps the window', c.chips.includes('3:05PM*') && c.axis.join() === '4PM,5PM,6PM', c.chips.join(' '));
await p.evaluate(() => showGameAt(0));
await p.waitForTimeout(300);

// a pinch
await tap('Whole week');
await p.waitForTimeout(300);
c = await chart();
ok('Whole week goes back to the whole week, cursor on the final', c.chips[0] === 'Whole week*' && !c.sum && c.time === 'MON 10:35 PM' && c.axis.join() === 'SUN 12PM,SUN 7PM,MON 7PM', c.axis.join(' ') + ' / ' + c.time);
// two fingers, landing one after the other the way they do
const pinch = async (from, to) => {
  const pt = (f) => box.x + box.w * f;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt(from[0]), y: box.y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt(from[0]), y: box.y, id: 0 }, { x: pt(from[1]), y: box.y + 10, id: 1 }] });
  for (let i = 1; i <= 8; i++) await touch([[pt(from[0] + (to[0] - from[0]) * i / 8), box.y], [pt(from[1] + (to[1] - from[1]) * i / 8), box.y + 10]]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(300);
};
// the minute under a point on the chart (0 to 1 across it), from the line as
// drawn and the points it was drawn from
const minuteAt = (f) => p.evaluate((f) => {
  const el = document.getElementById('userRewind'), x = f * 320;
  const xs = el.querySelector('.rw-line').getAttribute('points').split(' ').map((q) => +q.split(',')[0]), abs = el._rwPts.map((q) => q.abs);
  const i = xs.findIndex((v) => v >= x);
  return i <= 0 ? abs[Math.max(0, i)] : abs[i - 1] + (abs[i] - abs[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
}, f);
Object.assign(box, await p.evaluate(() => { const r = document.querySelector('#userRewind .rw-svg').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; }));
const was = [await minuteAt(0.3), await minuteAt(0.5)];
// spread two fingers on Sunday afternoon: what was between them, 30% to 50%
// of the way along the week, spreads to 10% and 90% of it
await pinch([0.3, 0.5], [0.1, 0.9]);
c = await chart();
const cust = c.ranges[c.chips.indexOf('Your stretch*')] || '';
ok('spreading two fingers zooms in on what was between them; the menu lists it as your stretch', /^SUN [\d:]+[AP]M\u2013[\d:]+[AP]M$/.test(cust) && c.chips[0] === 'Whole week' && c.sum && c.axis.length >= 2, cust + ' / ' + c.axis.join(' '));
const now = [await minuteAt(0.1), await minuteAt(0.9)];
ok('the minutes under the fingers stayed under them', Math.abs(now[0] - was[0]) <= 2 && Math.abs(now[1] - was[1]) <= 2, `${was.map(clock)} -> ${now.map(clock)}`);
ok('the first finger\'s scrub is undone: the cursor was on the final, outside the stretch, so it goes to the end of it', c.time === 'SUN ' + c.sum.match(/\u2013(\d+)(:\d\d)?([AP]M)/).slice(1).map((v, k) => k === 1 ? v || ':00' : k === 2 ? ' ' + v : v).join(''), c.time + ' / ' + c.sum);
// a scrub to a moment inside, then a small pinch: the cursor stays on it
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.w * 0.5, y: box.y, id: 0 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const t0 = (await chart()).time;
await pinch([0.3, 0.7], [0.25, 0.75]);
c = await chart();
ok('a pinch keeps the cursor on the moment it was on', Math.abs(mins(c.time) - mins(t0)) <= 2 && c.lineup === c.time, t0 + ' -> ' + c.time);
await p.screenshot({ path: OUT + '/zoom-pinch.png' });
// pinch in, all the way out
await pinch([0.1, 0.9], [0.47, 0.53]);
c = await chart();
ok('pinching in goes back out, to the whole week at most', c.chips[0] === 'Whole week*' && !c.sum, c.chips.join(' '));
// a trackpad pinch (ctrl + wheel)
await p.evaluate(() => { const r = document.querySelector('#userRewind .rw-svg').getBoundingClientRect(); document.querySelector('#userRewind .rw-svg').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, clientX: r.left + r.width * 0.5, clientY: r.top + 50, bubbles: true, cancelable: true })); });
await p.waitForTimeout(400);
c = await chart();
ok('ctrl + wheel (a trackpad pinch) zooms too', c.chips.includes('Your stretch*'), c.chips.join(' '));
await tap('Your stretch');
c = await chart();
ok('choosing your stretch again just closes the menu', !c.menu && c.chips.includes('Your stretch*'));
await tap('Whole week');
await p.waitForTimeout(300);
ok('Whole week clears it', (await chart()).chips[0] === 'Whole week*');
// a touch on the chart closes the menu (and scrubs, as ever)
await tapTime();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.w * 0.6, y: box.y + 40, id: 0 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok('touching the chart closes the menu', !(await chart()).menu);

// the matchup detail chart has its own
await p.evaluate(() => { toggleRewind('userRewind'); rwOpen.detailRewind = true; openDetail(1); });
await p.waitForTimeout(500);
c = await chart('detailRewind');
ok('another matchup\'s chart has the menu too', c.chips[0] === 'Whole week*' && c.chips.includes('12PM'), c.chips.join(' '));
await tap('12PM', 'detailRewind');
await p.waitForTimeout(300);
c = await chart('detailRewind');
ok('and zooms the same way', c.axis.join() === '12PM,1PM,2PM,3PM' && c.time === 'SUN 3:05 PM', c.axis.join(' '));

// the live week, at 2:22 PM Central on Sunday
await p.evaluate(() => { showTab('matchup'); if (!rwOpen.userRewind) toggleRewind('userRewind'); });
await tap('SNF');
console.log('week 4, live');
await p.evaluate(() => { pickWeek(4); });
await p.waitForTimeout(600);
await p.evaluate(() => { if (!rwOpen.userRewind) toggleRewind('userRewind'); });
await p.waitForTimeout(300);
c = await chart();
ok('the week\'s zoom is its own: week 4 opens on the whole week', c.chips[0] === 'Whole week*', c.chips.join(' '));
ok('only slots already under way: no 3:05PM, SNF or MNF yet', c.chips.includes('12PM') && !c.chips.some((t) => /3:05|SNF|MNF/.test(t)), c.chips.join(' '));
const card = await p.evaluate(() => [...document.querySelectorAll('#userHero .sh-pct')].map((e) => e.textContent.trim())[0]);
await tap('12PM');
await p.waitForTimeout(300);
c = await chart();
ok('12PM runs from noon to now, ending on the live odds', c.time === 'SUN 2:22 PM' && /12PM–Now/.test(c.sum) && c.read.includes(card.replace(/\s/g, '')), c.read + ' / card ' + card);
await p.screenshot({ path: OUT + '/zoom-live.png' });
await p.evaluate(() => liveRefresh(true));
await p.waitForTimeout(1500);
ok('a live refresh keeps the zoom', (await chart()).chips.includes('12PM*'));
await p.evaluate(() => pickWeek(3));
await p.waitForTimeout(400);
ok('and back in week 3, the whole week again', (await chart()).chips[0] === 'Whole week*', (await chart()).chips.join(' '));

// All Matchups: the strips are on the same time scale
await p.evaluate(() => showLeagueView());
await p.waitForTimeout(500);
const strips = await p.evaluate(() => [...document.querySelectorAll('.lg-spark polyline')].map((l) => l.getAttribute('points').split(' ').map((q) => +q.split(',')[0])));
ok('All Matchups strips still run edge to edge, in time order', strips.length > 3 && strips.every((xs) => xs[0] === 0 && xs[xs.length - 1] === 320 && xs.every((x, i) => !i || x > xs[i - 1])), `${strips.length} strips`);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
