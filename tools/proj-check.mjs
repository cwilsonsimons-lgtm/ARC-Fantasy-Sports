// A team's projected score (PROJ on the matchup) through a week, on the real
// City Boys Dynasty import, week 4. Before kickoff it is the lineup's
// projection; while games are played it is the points so far plus what is
// still to come, so a team whose whole lineup has played is projected exactly
// what it scored; and on the Tuesday after Monday night, when the app moves to
// the next week, week 4 shows again what it was projected before any game was
// played. ESPN's scoreboard and Sleeper's numbers are set to how they stood
// at each moment.
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
let NOW = Date.parse('2026-10-04T19:22:00Z');
const PRE = Date.parse('2026-10-02T00:15:00Z'); // week 4's first kickoff
// the scoreboard at NOW: not started, under way (as captured), or over
const board = (w) => {
  if (!fs.existsSync(R + `live/board_${w}.json`)) return '{"events":[]}';
  const d = JSON.parse(fs.readFileSync(R + `live/board_${w}.json`));
  d.events.forEach((e) => {
    const k = Date.parse(e.date), st = { ...e.status, type: { ...e.status.type } };
    if (k > NOW) Object.assign(st, { period: 0, clock: 0, type: { ...st.type, state: 'pre', completed: false } });
    else if (NOW - k > 230 * 6e4) Object.assign(st, { period: 4, clock: 0, type: { ...st.type, state: 'post', completed: true } });
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
    // before week 4 kicks off nobody has scored in it
    if (m[2] === 'matchups' && m[3] === '4' && NOW < PRE) return json(r, JSON.stringify(JSON.parse(fs.readFileSync(R + 'league/matchups_4.json')).map((t) => ({ ...t, points: 0, starters_points: t.starters.map(() => 0), players_points: {} }))));
    return file(r, R + 'league/' + (!m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json'));
  }
  if (u.hostname === 'api.sleeper.com') {
    const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/);
    if (m && m[1] === 'stats' && m[2] === '4' && NOW < PRE) return json(r, '[]');
    return file(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json');
  }
  if (u.hostname === 'site.api.espn.com') {
    if (u.pathname.endsWith('/scoreboard')) return json(r, board(u.searchParams.get('week')));
    return file(r, R + 'live/summary_' + u.searchParams.get('event') + '.json');
  }
  return r.abort();
});
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.051;

await p.clock.setFixedTime(new Date(NOW));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

async function at(iso, week) {
  NOW = Date.parse(iso);
  await p.clock.setFixedTime(new Date(NOW));
  await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('arc_live_v2') || '{}'); delete c.stats; delete c.games; localStorage.setItem('arc_live_v2', JSON.stringify(c)); });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  await p.evaluate(() => openLeague(myLeagues().find((l) => l.sleeper).id));
  await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
  await p.evaluate((w) => { showTab('matchup'); if (w) pickWeek(w); }, week);
  await p.waitForTimeout(1500);
}
// every matchup on the hero, one dot at a time: its teams, score and PROJ
const heroes = () => p.evaluate(async () => {
  const out = [];
  const n = document.querySelectorAll('#userHero .ms-dots i').length || 1;
  for (let i = 0; i < n; i++) {
    if (i) { document.querySelectorAll('#userHero .ms-dots i')[i].click(); await new Promise((r) => setTimeout(r, 450)); }
    const h = document.querySelector('#userHero');
    const keys = [...h.querySelectorAll('.ms-side .sh-tn')].map((e) => [...e.classList].find((c) => c.startsWith('tf-')).slice(3));
    const sc = h.querySelector('.sh-score').textContent.match(/[\d.]+/g).map(Number);
    const pj = (h.querySelector('.sh-proj') || {}).textContent;
    const pr = pj ? pj.match(/[\d.]+/g).map(Number) : null;
    out.push({ keys, sc, pr });
  }
  if (n > 1) { document.querySelectorAll('#userHero .ms-dots i')[0].click(); await new Promise((r) => setTimeout(r, 450)); }
  return out;
});
// a team's lineup this week, as the app has it: projection, and what is left
const lineup = (k) => p.evaluate((k) => starterPlayers(k).filter((q) => counts(q)).map((q) => ({ proj: +q.proj || 0, on: isLocked(q), left: lvLeft(q.tm) })), k);
const byTeam = (hs) => Object.fromEntries(hs.flatMap((h) => h.keys.map((k, i) => [k, { sc: h.sc[i], pr: h.pr && h.pr[i] }])));

console.log('Thursday afternoon, before week 4 kicks off');
await at('2026-10-01T20:00:00Z');
const pre = await heroes(), preBy = byTeam(pre);
let mine = pre[0], l = await lineup(mine.keys[0]);
const sum = l.reduce((n, q) => n + q.proj, 0);
ok('your PROJ is your lineup\'s projection', near(mine.pr[0], sum), `${mine.pr[0]} / ${sum.toFixed(1)}`);
ok(`every matchup shows one, nobody has scored (${pre.length})`, pre.length === 5 && pre.every((h) => h.pr && h.sc.every((v) => v === 0) && h.pr.every((v) => v > 50)), pre.map((h) => h.pr.join('-')).join(' '));

console.log('Sunday 3:22 PM ET, the early games nearly over');
await at('2026-10-04T19:22:00Z');
let live = await heroes();
mine = live[0];
for (const side of [0, 1]) {
  l = await lineup(mine.keys[side]);
  const rest = l.reduce((n, q) => n + (q.on ? q.proj * q.left : q.proj), 0);
  ok(`${side ? 'their' : 'your'} PROJ is the score so far plus what is still to come`, near(mine.pr[side], mine.sc[side] + rest), `${mine.sc[side]} + ${rest.toFixed(1)} = ${mine.pr[side]}`);
}
ok('the projections have moved off the pregame ones', live.some((h) => h.keys.some((k, i) => !near(h.pr[i], preBy[k].pr))));
await p.locator('#userHero').screenshot({ path: OUT + '/proj-sunday.png' });

console.log('Monday morning: Sunday is over, only New Orleans at Atlanta to come');
await at('2026-10-05T14:14:00Z');
live = await heroes();
const done = [], waiting = [];
for (const h of live) for (const [i, k] of h.keys.entries()) {
  l = await lineup(k);
  const rest = l.reduce((n, q) => n + (q.on ? q.proj * q.left : q.proj), 0);
  (rest === 0 ? done : waiting).push({ k, sc: h.sc[i], pr: h.pr[i], rest });
}
ok(`a team whose whole lineup has played is projected what it scored (${done.length} teams)`, done.length > 0 && done.every((t) => near(t.pr, t.sc)), done.map((t) => `${t.sc}/${t.pr}`).join(' '));
ok(`one with a Monday night player still to come: score + his projection (${waiting.length})`, waiting.every((t) => near(t.pr, t.sc + t.rest)), waiting.map((t) => `${t.sc}+${t.rest.toFixed(1)}=${t.pr}`).join(' '));
await p.locator('#userHero').screenshot({ path: OUT + '/proj-monday.png' });

console.log('Tuesday morning: the app is on week 5, week 4 looked back on');
await at('2026-10-06T14:00:00Z');
const wk = await p.evaluate(() => lvState().week);
const w5 = await heroes();
ok('the app has moved on to week 5, with its own projections', wk === 5 && w5[0].pr && w5[0].sc.every((v) => v === 0), JSON.stringify(w5[0]));
await p.evaluate(() => pickWeek(4));
await p.waitForFunction(() => !!document.querySelector('#userHero .sh-proj'), null, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
const back = await heroes(), backBy = byTeam(back);
ok('week 4 shows its final scores', back.every((h) => h.sc.some((v) => v > 0)));
ok('and each team\'s PROJ is again what it was before any game was played', Object.keys(preBy).length === 10 && Object.keys(preBy).every((k) => backBy[k] && near(backBy[k].pr, preBy[k].pr)), Object.keys(preBy).map((k) => `${preBy[k].pr}/${backBy[k] && backBy[k].pr}`).join(' '));
const card = await p.evaluate(() => { showTab('league'); return (document.querySelector('#leagueBody .lg-hero .sh-proj') || {}).textContent || ''; });
ok('your card in All Matchups says the same', card.includes(String(preBy[back[0].keys[0]].pr.toFixed(1))), card);
await p.evaluate(() => showTab('matchup'));
await p.locator('#userHero').screenshot({ path: OUT + '/proj-tuesday.png' });

ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
