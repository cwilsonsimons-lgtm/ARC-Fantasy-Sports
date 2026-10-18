// A player traded during the season plays for his new team. The app's player
// list is from before the season; Sleeper's weekly rows say which team each
// player played for that week (or is projected with) and which he is with
// now. Here Marvin Harrison Jr. is moved from Arizona to Houston in the real
// week 4 data (his week 3 row stays Arizona's, as it would), along with a few
// free agents to another team, and the imported City Boys Dynasty league must
// follow: his card, his game each week, his bye, his lock, and his points.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const URL_ = 'file://' + new URL('../1stPrototype.html', import.meta.url).pathname;
const MHJ = '11628';
// free agents in this league (on no roster) with a week 4 row: they move too
const rostered = new Set(JSON.parse(fs.readFileSync(R + 'league/rosters.json')).flatMap((r) => r.players || []));
const FA_TO = 'NYJ';
const faRows = JSON.parse(fs.readFileSync(R + 'live/proj_4.json')).filter((r) => r.player && r.player.position === 'WR' && r.team && r.team !== FA_TO && r.team !== 'HOU' && !rostered.has(r.player_id) && (r.stats.pts_ppr || 0) > 4).slice(0, 12);
const faMoved = faRows.map((r) => r.player_id), faNames = faRows.map((r) => r.player.first_name + ' ' + r.player.last_name);
// week 3 he played for Arizona; by week 4 he is a Texan, and Sleeper's player
// record (in every week's rows) says Houston
const moved = (name, rows) => rows.map((r) => {
  if (r.player_id === MHJ) return { ...r, team: name === 'stats_3' ? r.team : 'HOU', player: { ...r.player, team: 'HOU' } };
  if (faMoved.includes(r.player_id)) return { ...r, team: name === 'stats_3' ? r.team : FA_TO, player: { ...r.player, team: FA_TO } };
  return r;
});
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
let trade = false;
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
  if (u.hostname === 'api.sleeper.com') {
    const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/);
    const name = m && (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2], f = name && R + 'live/' + name + '.json';
    if (trade && f && fs.existsSync(f)) return json(r, JSON.stringify(moved(name, JSON.parse(fs.readFileSync(f)))));
    return file(r, f);
  }
  if (u.hostname === 'site.api.espn.com') return file(r, R + 'live/' + (u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));

await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);

// him, as the app has him: his card, and his entry on his fantasy team's roster
const him = () => p.evaluate(() => {
  const key = Object.keys(pIdx()).find((k) => (pIdx()[k].full || '').startsWith('Marvin Harrison'));
  const o = ownershipOf(key), row = rosterFor(o.team).find((q) => pKeyOf(q) === key);
  openPlayer(key);
  const card = document.querySelector('#playerBody .pc-tm').textContent.replace(/\s+/g, ' ').trim();
  const wk = document.querySelector('#playerBody').innerText.match(/THIS WEEK\s*\n?\s*([^\n]+)/i);
  return { key, card, week: wk && wk[1].trim(), tm: row.tm, g: row.g, bye: row.bye, ord: row.ord, locked: row.ord <= lvNowOrd(), pts: pLive(row.proj, row.n, row) };
});
const before = await him();
ok('before any trade: Arizona, on his card and his roster entry', before.card.startsWith('ARI') && before.tm === 'ARI', before.card);

// the trade: Sleeper's rows now say Houston
trade = true;
await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('arc_live_v2') || '{}'); delete c.stats; localStorage.setItem('arc_live_v2', JSON.stringify(c)); });
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => openLeague(myLeagues().find((l) => l.sleeper).id));
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(500);
let h = await him();
const exp = await p.evaluate(() => ({ g4: gameLabel('HOU', 4), g3: gameLabel('ARI', 3), g5: gameLabel('HOU', 5), bye: byeFor('HOU'), ord4: weekGame('HOU', 4).ord }));
console.log('after the trade');
ok('his card says Houston, with Houston\'s bye', h.card.startsWith('HOU') && h.card.includes('BYE ' + exp.bye), h.card);
ok('this week\'s game is Houston\'s', h.g === exp.g4 && (h.week || '').includes(exp.g4), `${h.g} / ${h.week}`);
ok('his lock is Houston\'s kickoff', h.ord === exp.ord4 && h.tm === 'HOU');
ok('his points are still his', Math.abs(h.pts - before.pts) < 0.01, `${h.pts} / ${before.pts}`);
await p.screenshot({ path: OUT + '/team-move-card.png', clip: { x: 0, y: 0, width: 390, height: 420 } });
// the week before the trade he played for Arizona
await p.evaluate(() => { showTab('matchup'); pickWeek(3); });
await p.waitForTimeout(400);
h = await him();
ok('week 3, before the trade: still Arizona\'s game', h.tm === 'ARI' && h.g === exp.g3, `${h.tm} ${h.g}`);
// a week Sleeper has not projected yet: the team he is with now
await p.evaluate(() => { showTab('matchup'); pickWeek(5); });
await p.waitForTimeout(400);
h = await him();
ok('week 5, not yet projected: Houston, the team he is with now', h.tm === 'HOU' && h.g === exp.g5, `${h.tm} ${h.g}`);
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(300);
// free agents read straight from the player list follow too
const fa = await p.evaluate(([to, names]) => freeAgents('WR').filter((q) => names.includes(q.full)).map((q) => [q.full, q.tm]), [FA_TO, faNames]);
const faCard = await p.evaluate((names) => { const q = freeAgents('WR').find((x) => names.includes(x.full)); if (!q) return null; openPlayer(pKeyOf(q)); return document.querySelector('#playerBody .pc-tm').textContent.trim(); }, faNames);
ok(`free agents who moved show their new team, in the list and on their card (${fa.length} of them)`, fa.length >= 3 && fa.every(([, tm]) => tm === FA_TO) && faCard && faCard.startsWith(FA_TO), `${fa.slice(0, 3).map((x) => x.join(' ')).join(', ')} / ${faCard}`);
// the side menu's Leaders and draft board lists too
const lists = await p.evaluate(() => {
  document.querySelector('.burger').click();
  onPanelSearch('leaders', 'harrison jr');
  const ld = [...document.querySelectorAll('#panel .ld-row')].find((r) => /Marvin Harrison/.test(r.textContent));
  selectRail('trending');
  onPanelSearch('trending', 'harrison jr');
  const tr = [...document.querySelectorAll('#panel .tr-row, #panel [class*="tr-"]')].find((r) => /Harrison/.test(r.textContent) && r.querySelector('.tr-mt'));
  clearPanelSearch('trending');
  selectRail('leaders');
  clearPanelSearch('leaders');
  document.querySelector('.burger').click();
  return { ld: ld && ld.querySelector('.ld-mt').textContent, tr: tr && tr.querySelector('.tr-mt').textContent };
});
ok('the side menu\'s Leaders and draft board show him with Houston', /\bHOU\b/.test(lists.ld || '') && /\bHOU\b/.test(lists.tr || ''), JSON.stringify(lists));
// and it all holds through a reload, from the saved data alone
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(600);
const cached = await p.evaluate((key) => { const id = pIdx()[key].id, c = JSON.parse(localStorage.getItem('arc_live_v2') || '{}'); return { now: c.cur && c.cur[id] && c.cur[id][0], w3: c.tms && c.tms[3] && c.tms[3][id], n3: c.tms && c.tms[3] && Object.keys(c.tms[3]).length }; }, h.key);
ok('saved on the phone: who he is with now, and who he played for in each finished week', cached.now === 'HOU' && cached.w3 === 'ARI' && cached.n3 > 100, JSON.stringify(cached));
await p.evaluate(() => openLeague(myLeagues().find((l) => l.sleeper).id));
await p.waitForTimeout(400);
await p.evaluate(() => { showTab('matchup'); pickWeek(5); });
await p.waitForTimeout(300);
const off = await p.evaluate((key) => { const o = ownershipOf(key), row = rosterFor(o.team).find((q) => pKeyOf(q) === key); return row.tm; }, h.key);
ok('so a reload shows Houston before anything is fetched', off === 'HOU', off);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
