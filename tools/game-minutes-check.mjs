// The win-probability chart is game minutes only: a point for every minute a
// game is being played, the hours between games taken out. Live, it runs to
// now while a game is on; between games (Monday morning, before Monday Night
// Football) it ends on the last minute played, not on the clock, and a game
// that runs long (overtime) keeps it going. Real City Boys Dynasty import,
// week 4, with ESPN's scoreboard set to how it stood at each moment.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const URL_ = 'file://' + new URL('../1stPrototype.html', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
// the scoreboard: games that kicked off before `done` are over, `going` is in overtime
let done = null, going = null;
const board = (w) => {
  const d = JSON.parse(fs.readFileSync(R + `live/board_${w}.json`));
  d.events.forEach((e) => {
    const st = { ...e.status, type: { ...e.status.type } };
    if (going && e.date === going) Object.assign(st, { period: 5, clock: 300, type: { ...st.type, state: 'in', completed: false } });
    else if (done && Date.parse(e.date) < done) Object.assign(st, { period: 4, clock: 0, type: { ...st.type, state: 'post', completed: true } });
    e.status = st;
    e.competitions[0].status = st;
  });
  return JSON.stringify(d);
};
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body, headers: { 'access-control-allow-origin': '*' } });
const file = (r, f) => json(r, f && fs.existsSync(f) ? fs.readFileSync(f) : '[]');
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    const m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== '1312045587541020672') return r.fulfill({ status: 404, body: 'null' });
    return file(r, R + 'league/' + (!m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json'));
  }
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return file(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'); }
  if (u.hostname === 'site.api.espn.com') {
    if (u.pathname.endsWith('/scoreboard')) return json(r, board(u.searchParams.get('week')));
    return file(r, R + 'live/summary_' + u.searchParams.get('event') + '.json');
  }
  return r.abort();
});
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const absMin = (ord) => Math.floor(ord / 2e3) * 1440 + ord % 2e3;

await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

// the chart as it stands at `at`, after a fresh load with that scoreboard
async function chartAt(at) {
  await p.clock.setFixedTime(new Date(at));
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  await p.evaluate(() => openLeague(myLeagues().find((l) => l.sleeper).id));
  await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
  await p.evaluate(() => { showTab('matchup'); if (!rwOpen.userRewind) toggleRewind('userRewind'); });
  await p.waitForTimeout(500);
  return p.evaluate(() => {
    const el = document.getElementById('userRewind'), pts = el._rwPts, sp = pts.span;
    const xs = [...el.querySelector('.rw-line').getAttribute('points').matchAll(/([\d.]+),/g)].map((m) => +m[1]);
    return {
      pts: pts.map((q) => ({ abs: q.abs, w: q.w, win: q.win, ev: q.ev.length, ko: !!q.ko })), windows: sp.windows, now: sp.now, playing: sp.playing,
      clock: lvNowOrd(), when: el.querySelector('.rw-read .tt').textContent, menu: (el.querySelector('.rw-menu') || {}).textContent || '',
      xLast: xs[xs.length - 1], card: getGames(lvState().week).find((g) => g.me).aw
    };
  });
}
const inside = (c, t) => c.windows.some(([ws, we]) => t >= ws && t <= we);
// within a window, no two points more than a minute apart
const everyMinute = (c) => c.pts.every((q, i) => !i || q.w !== c.pts[i - 1].w || q.abs - c.pts[i - 1].abs <= 1);

console.log('Sunday 3:22 PM ET, the late games about to start');
let c = await chartAt('2026-10-04T19:22:00Z');
let last = c.pts[c.pts.length - 1];
ok('a game is on: the chart runs to now', c.playing && last.abs === absMin(c.clock), `${last.abs} / ${absMin(c.clock)}`);
ok('every point is in a game window', c.pts.every((q) => inside(c, q.abs)));
ok(`a point for every minute played (${c.pts.length})`, everyMinute(c) && c.pts.length > 400);
ok('its latest point is the card\'s odds', last.win === c.card, `${last.win} / ${c.card}`);
ok('the zoom menu says the stretch runs to now', /Now/.test(c.menu), c.menu.slice(0, 80));

console.log('Monday 10:14 AM ET, Sunday\'s games over, Monday night\'s to come');
done = Date.parse('2026-10-05T12:00:00Z');
c = await chartAt('2026-10-05T14:14:00Z');
last = c.pts[c.pts.length - 1];
const sunEnd = Math.max(...c.windows.filter(([ws]) => ws < absMin(c.clock)).map(([, we]) => we));
ok('no game on: the chart ends on the last minute played, Sunday night', !c.playing && last.abs === sunEnd && last.abs < absMin(c.clock) - 600, `ends ${c.when}`);
ok('the time over the chart is that minute, not Monday morning', /^SUN \d+:\d\d PM$/.test(c.when), c.when);
ok('no point between games', c.pts.every((q) => inside(c, q.abs)));
ok(`a point for every minute played (${c.pts.length})`, everyMinute(c) && c.pts.length > 900);
const before = c.pts[c.pts.length - 2];
ok('the line runs straight into the latest odds (no jump at the end)', Math.abs(last.win - before.win) <= 2 && last.win === c.card, `${before.win} → ${last.win}, card ${c.card}`);
ok('Sunday night\'s last minute is the chart\'s right edge', Math.abs(c.xLast - 316) < 0.2, String(c.xLast));
ok('the zoom menu does not call Sunday night "now"', !/Now/.test(c.menu), c.menu.slice(0, 80));
await p.locator('#userRewind').screenshot({ path: OUT + '/game-minutes-monday.png' });

console.log('week 3, finished: no spikes');
// the line only jumps at a scoring play or a kickoff; a player's other points
// come in steadily (they used to land in four lumps at the quarter breaks,
// against a projection running down minute by minute: a sawtooth), and the
// odds run in straight lines between those moments rather than curling
await p.evaluate(() => { pickWeek(3); if (!rwOpen.userRewind) toggleRewind('userRewind'); });
await p.waitForTimeout(2500);
await p.evaluate(() => pickWeek(3));
await p.waitForTimeout(800);
const w3 = await p.evaluate(() => {
  const pts = document.getElementById('userRewind')._rwPts, v = pts.map((q) => q.wf != null ? q.wf : q.win);
  // the moments a line may bend at: a scoring play or the minute before it, a
  // kickoff, a game's end, a window's edge
  const ends = new Set(pts.span.kicks.map((k) => k + 200));
  const moment = (i) => !!(pts[i].ev.length || pts[i].ko || pts[i + 1] && pts[i + 1].ev.length || ends.has(pts[i].abs) || !i || i === pts.length - 1 || pts[i - 1].w !== pts[i].w || pts[i + 1].w !== pts[i].w);
  let curls = 0;
  for (let i = 1; i + 1 < v.length; i++) if (!moment(i) && Math.abs((v[i + 1] - v[i]) - (v[i] - v[i - 1])) > 1e-6) curls++;
  let quiet = 0, turns = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    // (the last minute is the final whistle: the result is settled there)
    if (i < v.length - 1 && pts[i].w === pts[i - 1].w && !pts[i].ev.length && !pts[i].ko && Math.abs(d) >= 2) quiet++;
    if (i + 1 < v.length && d * (v[i + 1] - v[i]) < 0 && Math.abs(d) > 0.05 && Math.abs(v[i + 1] - v[i]) > 0.05 && !pts[i].ev.length && !pts[i + 1].ev.length) turns++;
  }
  return { quiet, turns, curls, n: v.length, plays: pts.filter((q) => q.ev.length).length };
});
ok(`no jump without a scoring play or kickoff behind it (${w3.n} minutes, ${w3.plays} scoring plays)`, w3.quiet === 0, JSON.stringify(w3));
ok('and no sawtooth: between scoring plays the line does not zigzag', w3.turns <= 2, JSON.stringify(w3));
ok('straight lines: it only changes course at a kickoff, a scoring play or a game\'s end', w3.curls === 0, JSON.stringify(w3));
await p.locator('#userRewind').screenshot({ path: OUT + '/game-minutes-week3.png' });

console.log('Sunday 11:55 PM ET, Sunday night\'s game in overtime');
done = Date.parse('2026-10-05T00:00:00Z'); going = '2026-10-05T00:20Z';
c = await chartAt('2026-10-05T03:55:00Z');
last = c.pts[c.pts.length - 1];
ok('a game still going past its usual length keeps the chart running to now', c.playing && last.abs === absMin(c.clock), c.when);
ok('every minute of it', everyMinute(c) && c.pts.every((q) => inside(c, q.abs)));
going = null; done = Date.parse('2026-10-05T12:00:00Z');
c = await chartAt('2026-10-05T03:55:00Z');
last = c.pts[c.pts.length - 1];
ok('once it is over, the chart ends where it did', !c.playing && last.abs < absMin(c.clock), c.when);

ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
