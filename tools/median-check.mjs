// The League tab: over the week's games, the league median (the middle of all
// ten teams' scores) and, smaller beside it, the projected league median (the
// middle of the teams' PROJ). The week stepper above it stays. Real City
// Boys Dynasty import, week 4: before kickoff, on Sunday afternoon, a week
// ahead, and looked back on once it is over. A week that is over marks each
// team that won its game and beat the league median.
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
const PRE = Date.parse('2026-10-02T00:15:00Z');
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
const median = (v) => { const s = v.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

await p.clock.setFixedTime(new Date(NOW));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

async function at(iso) {
  NOW = Date.parse(iso);
  await p.clock.setFixedTime(new Date(NOW));
  await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('arc_live_v2') || '{}'); delete c.stats; delete c.games; localStorage.setItem('arc_live_v2', JSON.stringify(c)); });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  await p.evaluate(() => openLeague(myLeagues().find((l) => l.sleeper).id));
  await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
}
// the League tab as shown: the line over the games, the games' scores, and
// each team's PROJ as its matchup shows it
const league = (w) => p.evaluate(async (w) => {
  if (w) pickWeek(w);
  await new Promise((r) => setTimeout(r, 1200));
  showTab('standings');
  await new Promise((r) => setTimeout(r, 300));
  const v = document.querySelector('.view[data-view="standings"]'), med = v.querySelector('#standMedian');
  const big = med.querySelector('.mv'), small = med.querySelector('.pm');
  return {
    text: med.innerText.replace(/\s+/g, ' ').trim(), mv: big && big.textContent, pm: small && small.textContent,
    sizes: [big && parseFloat(getComputedStyle(big).fontSize), small && parseFloat(getComputedStyle(small).fontSize)],
    scores: [...v.querySelectorAll('#standMatchups .sm-pt')].map((e) => +e.textContent),
    // each card's two rows: score, and whether the double-win mark is by it
    cards: [...v.querySelectorAll('#standMatchups .sm-card')].map((c) => [...c.querySelectorAll('.sm-tr')].map((r) => ({ sc: +r.querySelector('.sm-pt').textContent, two: !!r.querySelector('.sm-dbl') }))),
    key: !!med.querySelector('.sm-key'),
    proj: getGames(lvState().viewWeek).flatMap((g) => [teamProj(g.a, lvState().viewWeek, g.as), teamProj(g.x, lvState().viewWeek, g.xs)]),
    stepper: !!v.querySelector('.wsw .wk') && v.querySelector('.wsw .wk').textContent.includes('Week ' + lvState().viewWeek),
    oldLine: [...v.querySelectorAll('.hd')].some((e) => /Matchups/i.test(e.textContent)),
    week: lvState().viewWeek
  };
}, w);
const num = (s) => s ? +s.match(/[\d.]+/)[0] : null;
// the teams that should carry the mark: won their game and beat the median
const doubles = (L) => { const m = median(L.scores); return L.cards.flatMap(([a, x]) => [a.sc > x.sc && a.sc > m, x.sc > a.sc && x.sc > m]); };
const marked = (L) => L.cards.flatMap(([a, x]) => [a.two, x.two]);

console.log('Sunday 3:22 PM ET, week 4 under way');
await at('2026-10-04T19:22:00Z');
let L = await league();
ok('the "Week 4 · Matchups" line is gone, the week stepper above stays', !L.oldLine && L.stepper);
ok(`league median: the middle of the ten scores (${L.scores.join(' ')})`, L.scores.length === 10 && Math.abs(num(L.mv) - median(L.scores)) < 0.051, L.text);
ok('projected league median beside it: the middle of the ten PROJ', Math.abs(num(L.pm) - median(L.proj)) < 0.051, L.pm);
ok('the projected one is smaller', L.sizes[1] < L.sizes[0], L.sizes.join(' / '));
ok('while the week is played nobody has the double-win mark yet', !marked(L).some(Boolean) && !L.key);
await p.locator('.view[data-view="standings"]').screenshot({ path: OUT + '/median-live.png', clip: { x: 0, y: 0, width: 390, height: 420 } }).catch(() => p.screenshot({ path: OUT + '/median-live.png' }));
L = await league(5);
ok('a week ahead: no median yet, only the projected one', L.week === 5 && L.mv === '—' && num(L.pm) > 50 && Math.abs(num(L.pm) - median(L.proj)) < 0.051, L.text);

console.log('Thursday, before week 4 kicks off');
await at('2026-10-01T20:00:00Z');
L = await league();
ok('no median yet, the projected one is there', L.mv === '—' && Math.abs(num(L.pm) - median(L.proj)) < 0.051, L.text);
const pre = num(L.pm);

console.log('Tuesday, week 4 looked back on');
await at('2026-10-06T14:00:00Z');
L = await league(4);
if (!L.pm) { await p.waitForTimeout(1500); L = await league(); }
ok('the final median, and the projected median from before kickoff', Math.abs(num(L.mv) - median(L.scores)) < 0.051 && num(L.pm) === pre, `${L.text} (Thursday: ${pre})`);
let want = doubles(L), got = marked(L);
ok(`week 4 over: the mark is on each team that won and beat the median, and no other (${got.filter(Boolean).length})`, want.some(Boolean) && want.every((w, i) => w === got[i]), JSON.stringify(L.cards));
ok('the line over the games says what the mark means', L.key && /Won \+ beat median/i.test(L.text), L.text);
const lost = L.cards.flatMap(([a, x]) => [[a, x], [x, a]]).filter(([t, o]) => t.sc < o.sc && t.sc > median(L.scores));
ok(`a team over the median that lost its game has no mark (${lost.map(([t]) => t.sc).join(', ')})`, lost.length > 0 && lost.every(([t]) => !t.two));
await p.screenshot({ path: OUT + '/median-double.png', clip: { x: 0, y: 0, width: 390, height: 640 } });
L = await league(3);
want = doubles(L); got = marked(L);
ok(`and week 3 the same (${got.filter(Boolean).length} teams)`, L.week === 3 && want.some(Boolean) && want.every((w, i) => w === got[i]), L.cards.map(([a, x]) => `${a.sc}${a.two ? '*' : ''}-${x.sc}${x.two ? '*' : ''}`).join(' '));
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
