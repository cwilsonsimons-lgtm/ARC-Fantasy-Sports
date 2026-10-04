// Live stats against real Sleeper/ESPN responses saved in tools/fixtures/live.
import { chromium } from 'playwright';
import fs from 'fs';
const FX = new URL('./fixtures/live/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const errs = [], hits = {};
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  let f = null;
  if (u.hostname === 'api.sleeper.com') {
    const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/);
    if (m) f = (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json';
  } else if (u.hostname === 'site.api.espn.com') {
    if (u.pathname.endsWith('/scoreboard')) f = 'board_' + u.searchParams.get('week') + '.json';
    if (u.pathname.endsWith('/summary')) f = 'summary_' + u.searchParams.get('event') + '.json';
  }
  hits[u.hostname + ' ' + (f || u.pathname)] = (hits[u.hostname + ' ' + (f || u.pathname)] || 0) + 1;
  if (f && fs.existsSync(FX + f)) return r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(FX + f), headers: { 'access-control-allow-origin': '*' } });
  if (f) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } });
  return r.abort();
});
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(500);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const info = await p.evaluate(`lvState()`);
console.log(JSON.stringify(info));
ok('live week is 4 (Oct 4, 2026)', info.week === 4 && info.viewWeek === 4);
await p.evaluate(`openLeague('cbd'); autoDraftAll()`);
await p.evaluate(`liveRefresh(true)`);
await p.waitForFunction(`LIVE.loaded['stats:4'] && LIVE.loaded['stats:3'] && LIVE.loaded['proj:4']`, null, { timeout: 20000 });
await p.waitForTimeout(800);
// 1. matching coverage + points agree with Sleeper's own PPR totals
const cov = await p.evaluate(`(() => {
  const out = {};
  for (const w of [1, 2, 3, 4]) out[w] = Object.keys(LIVE.stats[w] || {}).length;
  return out;
})()`);
console.log('matched players per week', JSON.stringify(cov));
const raw3 = JSON.parse(fs.readFileSync(FX + 'stats_3.json'));
const sample = raw3.filter(r => (r.stats.pts_ppr || 0) > 5).slice(0, 400).map(r => ({ n: r.player.first_name + ' ' + r.player.last_name, pos: r.player.position, ppr: r.stats.pts_ppr, rec: r }));
const cmp = await p.evaluate((list) => {
  let matched = 0, same = 0, diffs = [];
  // score with plain PPR so the comparison is like for like
  const ppr = Object.assign({}, scoringBag());
  Object.keys(ppr).forEach(k => ppr[k] = 0);
  Object.assign(ppr, { passYd: 0.04, passTD: 4, passInt: -1, pass2pt: 2, rushYd: 0.1, rushTD: 6, rush2pt: 2, rec: 1, recYd: 0.1, recTD: 6, rec2pt: 2, fumLost: -2, fumTD: 6, stpTD: 6 });
  list.forEach(x => {
    const id = lvMatch(x.rec); if (!id) return; matched++;
    const line = LIVE.stats[3][id]; if (!line) return;
    const pts = scoreStats(line, { pos: x.pos, scoring: ppr }).total;
    if (Math.abs(pts - x.ppr) < 0.06) same++; else if (diffs.length < 6) diffs.push(x.n + ' app ' + pts + ' vs sleeper ' + x.ppr);
  });
  return { n: list.length, matched, same, diffs };
}, sample);
console.log(JSON.stringify(cmp));
ok(`players with 5+ PPR pts matched to the app: ${cmp.matched}/${cmp.n}`, cmp.matched / cmp.n > 0.85);
ok(`app's PPR score equals Sleeper's pts_ppr: ${cmp.same}/${cmp.matched}`, cmp.same / cmp.matched > 0.97, cmp.diffs.join('; '));
// 2. a known line: Bijan Robinson week 3 (Sleeper: 194 rush yd, 2 TD, 2 rec)
const bijan = await p.evaluate(`(() => { const id = Object.keys(NFL_BY_ID).find(k => NFL_BY_ID[k].full === 'Bijan Robinson'); return { id, line: lvLine({ id }, 3) }; })()`);
ok('Bijan Robinson week 3 line is real', bijan.line && bijan.line.rushYd === 194 && bijan.line.rushTD === 2 && bijan.line.bRush100 === 1, JSON.stringify(bijan.line));
// 3. my matchup in the live week: real points, real locks, real projections
const mu = await p.evaluate(`(() => {
  const [a, x] = liveSides();
  const rows = starterPlayers(a).concat(starterPlayers(x)).map(p => ({ n: p.n, tm: p.tm, g: p.g, locked: isLocked(p), pts: pLive(p.proj, p.n, p), proj: p.proj, left: lvLeft(p.tm) }));
  return { a, x, LT: lvState().LT, rows };
})()`);
console.log(JSON.stringify(mu.LT));
mu.rows.forEach(r => console.log('   ', r.n.padEnd(18), r.tm.padEnd(4), (r.g || '').padEnd(22), r.locked ? 'LOCKED' : 'open  ', String(r.pts).padStart(5), 'proj', r.proj, 'left', Math.round(r.left * 100) + '%'));
ok('players whose game started are locked, later ones open', mu.rows.some(r => r.locked) && mu.rows.some(r => !r.locked));
ok('unstarted players have 0 points', mu.rows.filter(r => !r.locked).every(r => r.pts === 0));
ok('started players carry real points', mu.rows.filter(r => r.locked).some(r => r.pts > 0));
ok('projections are this week\'s', mu.rows.every(r => r.proj >= 0));
await p.evaluate(`showView('matchup'); renderUserMatchup()`);
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/L1-matchup-live.png' });
// 4. the graph
await p.evaluate(`(() => { const b = document.querySelector('[data-rw="userRewind"]'); if (b) b.click(); else toggleRewind('userRewind'); })()`);
await p.waitForTimeout(600);
const rw = await p.evaluate(`(() => { const el = document.getElementById('userRewind'); return { shown: el && el.style.display !== 'none', svg: !!(el && el.querySelector('svg')), html: el ? el.innerText.slice(0, 200) : '' }; })()`);
ok('Rewind graph opens for the live week', rw.shown && rw.svg, JSON.stringify(rw.html));
const jumps = await p.evaluate(`(() => { const [a] = liveSides(); return starterPlayers(a).map(p => [p.n, JSON.stringify(lvJumps(p, 4))]); })()`);
jumps.forEach(j => console.log('    jumps', j[0], j[1]));
await p.evaluate(`document.getElementById('userRewind').scrollIntoView()`);
await p.screenshot({ path: OUT + '/L2-rewind-live.png' });
// 5. past week, other matchups, standings
await p.evaluate(`pickWeek(3); refreshApp()`);
await p.waitForTimeout(500);
const g3 = await p.evaluate(`getGames(3).map(g => [g.a, g.as, g.x, g.xs, g.status])`);
console.log('week 3 games', JSON.stringify(g3));
ok('week 3 team scores are real starter sums and final', g3.every(g => g[4] === 'final') && g3.some(g => g[1] > 0));
const g4 = await p.evaluate(`getGames(4).map(g => [g.a, g.as, g.x, g.xs, g.status])`);
console.log('week 4 games', JSON.stringify(g4));
ok('week 4 other matchups show live scores', g4.filter(g => g[4] === 'live').length === g4.length && g4.some(g => g[1] > 0));
await p.evaluate(`pickWeek(3); showView('matchup'); renderUserMatchup()`);
await p.waitForTimeout(400);
await p.evaluate(`(() => { const b = document.querySelector('[data-rw="userRewind"]'); if (b) b.click(); })()`);
await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/L3-week3-rewind.png' });
// 6. created league keeps working
const cl = await p.evaluate(`(() => {
  const id = 'lglive', teams = []; for (let i = 0; i < 8; i++) teams.push(newTeam(i, i ? null : 'You'));
  myLeagues().push({ id, name: 'Live Test League', created: Date.now(), invite: 'x', joined: 8, teams, league: Object.assign({}, LEAGUE_DEFAULTS, { teams: 8, commish: 't0' }), scoring: Object.assign({}, SCORING_DEFAULTS), slots: Object.assign({}, SLOT_DEFAULTS) });
  store.leagueOrder.push(id); saveStore(); startCreatedDraft(id); autoDraftAll(); pickWeek(lvState().week); recomputeLT();
  const st = lvState(); return { week: st.viewWeek, LT: st.LT, games: getGames(st.week).length };
})()`);
console.log(JSON.stringify(cl));
ok('created league: live matchup has real points', cl.LT.a + cl.LT.x > 0 && cl.games === 4);
console.log('requests', JSON.stringify(hits));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
