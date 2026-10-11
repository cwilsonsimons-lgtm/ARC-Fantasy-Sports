// A league created after the season began starts 0-0 and counts only what
// happens from the moment it was made. Real week 1-4 data; the league is made
// at 11:00 ET on Sunday of week 4 (after Thursday's game, before the 1:00s).
import { chromium } from 'playwright';
import fs from 'fs';
const FX = new URL('./fixtures/live/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  let f = null;
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); if (m) f = (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'; }
  if (u.hostname === 'site.api.espn.com') f = u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') + '.json' : 'summary_' + u.searchParams.get('event') + '.json';
  if (f) return r.fulfill({ status: 200, contentType: 'application/json', body: fs.existsSync(FX + f) ? fs.readFileSync(FX + f) : '[]', headers: { 'access-control-allow-origin': '*' } });
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(600);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const MADE = Date.UTC(2026, 9, 4, 15, 0); // 11:00 ET, Sunday of week 4
await p.evaluate((made) => {
  const id = 'lgwork', teams = [];
  for (let i = 0; i < 10; i++) teams.push(newTeam(i, i ? null : 'You'));
  myLeagues().push({ id, name: 'Work Fantasy League', created: made, invite: 'x', joined: 10, teams, league: Object.assign({}, LEAGUE_DEFAULTS, { teams: 10, commish: 't0' }), scoring: Object.assign({}, SCORING_DEFAULTS), slots: Object.assign({}, SLOT_DEFAULTS) });
  store.leagueOrder.push(id); saveStore(); startCreatedDraft(id); autoDraftAll();
}, MADE);
await p.evaluate(() => liveRefresh(true));
await p.waitForFunction(() => LIVE.loaded['stats:4'] && LIVE.loaded['stats:3'], null, { timeout: 20000 });
await p.waitForTimeout(800);
const st = await p.evaluate(() => {
  const ls = leagueStart();
  const games = [1, 2, 3, 4].map((w) => getGames(w).map((g) => [g.as, g.xs]));
  const recs = Object.keys(T).map((k) => T[k].rec);
  // week 4 starters: those whose game kicked off before 11:00 ET count for nothing
  const rows = [];
  Object.keys(T).forEach((k) => weekStarters(k, 4).forEach((pl) => {
    const g = weekGame(pl.tm, 4);
    if (g) rows.push({ n: pl.n, before: g.ord < ls.ord, counts: counts(pl, 4), live: pLive(pl.proj, pl.n, pl, 4), real: lvPoints(pl, 4) || 0 });
  }));
  const team = Object.keys(T).map((k) => ({ k, score: seededScore(4, k), sum: weekStarters(k, 4).filter((pl) => counts(pl, 4)).reduce((n, pl) => n + (lvPoints(pl, 4) || 0), 0), pf: seasonTotals(k).pf }));
  return { ls, games, recs, rows, team };
});
console.log('   league start', JSON.stringify(st.ls), ' week 4 scores', JSON.stringify(st.games[3]));
ok('the league starts in week 4, at the moment it was made', st.ls.week === 4);
ok('weeks 1-3 are not its own: every score is 0', st.games.slice(0, 3).every((w) => w.every(([a, x]) => a === 0 && x === 0)));
ok('every team is 0-0', st.recs.every((r) => r === '0-0'), st.recs.join(' '));
const before = st.rows.filter((r) => r.before), after = st.rows.filter((r) => !r.before);
ok(`week 4: ${before.length} starters whose game kicked off before the league count 0`, before.length > 0 && before.every((r) => !r.counts && r.live === 0), before.map((r) => `${r.n} ${r.real}`).slice(0, 4).join(', '));
ok(`week 4: ${after.length} starters playing after it count their real points`, after.some((r) => r.live > 0) && after.every((r) => r.counts && Math.abs(r.live - Math.round(r.real * 100) / 100) < 0.01));
ok('team scores and points for are only what counts', st.team.every((t) => Math.abs(t.score - Math.round(t.sum * 10) / 10) < 0.06 && Math.abs(t.pf - t.score) < 0.06));
// what the screens say
await p.evaluate(() => { pickWeek(4); showTab('matchup'); renderUserMatchup(); });
await p.waitForTimeout(400);
const hero = await p.evaluate(() => [...document.querySelectorAll('#userHero .sh-rec')].map((e) => e.textContent));
ok('the matchup shows 0-0 records', hero.length === 2 && hero.every((t) => / 0-0$/.test(t)), hero.join(' | '));
const pre = await p.evaluate(() => [...document.querySelectorAll('#userLineup .g2.sl')].map((e) => e.textContent.replace(/ /g, ' ')).filter((t) => /^Before league/.test(t)));
ok(`rows of players who played before the league say so (${pre.length})`, pre.length > 0, pre[0]);
await p.screenshot({ path: OUT + '/start-matchup.png' });
await p.evaluate(() => openSchedule(MY_TEAM));
await p.waitForTimeout(300);
const sch = await p.evaluate(() => [...document.querySelectorAll('#schedBody .sch-row')].slice(0, 5).map((r) => r.innerText.replace(/\s+/g, ' ')));
ok('the schedule marks weeks 1-3 as before the league started', sch.slice(0, 3).every((t) => /Before the league started/.test(t)) && !/Before the league/.test(sch[3]), sch[3]);
await p.screenshot({ path: OUT + '/start-schedule.png' });
// City Boys counts every week
const cbd = await p.evaluate(() => { closeSchedule(); goHome(); openLeague('cbd'); autoDraftAll(); syncRecords(); return { ls: leagueStart(), recs: Object.keys(T).map((k) => T[k].rec) }; });
ok('City Boys counts the whole season', cbd.ls === null && cbd.recs.some((r) => r !== '0-0'), cbd.recs.join(' '));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
