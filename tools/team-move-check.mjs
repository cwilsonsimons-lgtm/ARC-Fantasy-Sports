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
// One of your own starters, Nico Collins, goes from Houston (who kicked off
// at 1:00) to Miami (4:05, not yet started): his week 4 stats row goes, since
// he has not played yet.
const NICO = '7569';
// week 3 he played for Arizona; by week 4 he is a Texan, and Sleeper's player
// record (in every week's rows) says Houston
const moved = (name, rows) => rows.filter((r) => !(r.player_id === NICO && name === 'stats_4')).map((r) => {
  if (r.player_id === MHJ) return { ...r, team: name === 'stats_3' ? r.team : 'HOU', player: { ...r.player, team: 'HOU' } };
  if (r.player_id === NICO) return { ...r, team: name === 'stats_3' ? r.team : 'MIA', player: { ...r.player, team: 'MIA' } };
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
  return { key, id: row.id, card, week: wk && wk[1].trim(), tm: row.tm, g: row.g, bye: row.bye, ord: row.ord, locked: row.ord <= lvNowOrd(), pts: pLive(row.proj, row.n, row) };
});
const before = await him();
ok('before any trade: Arizona, on his card and his roster entry', before.card.startsWith('ARI') && before.tm === 'ARI', before.card);
// how many players the list shipped with a team Sleeper disagrees with (real moves since it was made)
const stale = await p.evaluate(() => POOL.filter((q) => q.tm0 && q.tm0 !== q.tm).map((q) => `${q.n} ${q.tm0}>${q.tm}`));
const real = stale.filter((x) => !/>FA$/.test(x));
console.log(`   the app's list had ${stale.length} players on an old team: ${real.length} now with another team (${real.slice(0, 5).join(', ')}, ...), ${stale.length - real.length} now unsigned`);
ok('players already moved in the real data are on their new teams', stale.length > 0 && await p.evaluate(() => POOL.filter((q) => q.tm0 && q.tm0 !== q.tm).every((q) => pIdx()[pKeyOf(q)].tm === q.tm || pIdx()[pKeyOf(q)].g != null)));

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
// his fantasy team's page, and the stats sheet for his week
const more = await p.evaluate((key) => {
  pickWeek(4);
  const o = ownershipOf(key);
  openTeam(o.team);
  const row = [...document.querySelectorAll('#teamBody .tv-row')].find((r) => /Harrison/.test(r.textContent));
  // the card's week-by-week log: Houston's bye is his now, Arizona's is not
  openPlayer(key);
  const log = Object.fromEntries([...document.querySelectorAll('#playerBody .pw-row')].map((r) => [r.querySelector('.pw-w').textContent, !!r.querySelector('.bye')]));
  return { row: row && row.querySelector('.tv-pmeta').textContent, bye8: log['Week 8'], bye14: log['Week 14'] };
}, h.key);
ok('his fantasy team\'s page lists him with Houston', /\bHOU\b/.test(more.row || ''), more.row);
ok('his card\'s weekly log has Houston\'s bye (week 8), not Arizona\'s (week 14)', more.bye8 === true && more.bye14 === false, JSON.stringify(more));
// touchdowns on the chart come from the game he played that week: a week 3
// touchdown is in Arizona's plays, a week 4 one in Houston's
const tds = await p.evaluate((key) => {
  const td = { min: 20, q: 2, clk: '5:00', type: 'Passing Touchdown', text: 'Marvin Harrison Jr. 25 Yd pass from Kyler Murray (Chad Ryland Kick)' };
  const was3 = LIVE.plays[3], was4 = LIVE.plays[4];
  LIVE.plays[3] = Object.assign({}, was3, { ARI: [td], HOU: [] });
  LIVE.plays[4] = Object.assign({}, was4, { ARI: [], HOU: [td] });
  const out = { w3: lvTdPlays(key, 3).length, w4: lvTdPlays(key, 4).length };
  LIVE.plays[3] = Object.assign({}, was3, { ARI: [], HOU: [td] });
  LIVE.plays[4] = Object.assign({}, was4, { ARI: [td], HOU: [] });
  out.w3wrong = lvTdPlays(key, 3).length;
  out.w4wrong = lvTdPlays(key, 4).length;
  LIVE.plays[3] = was3;
  LIVE.plays[4] = was4;
  return out;
}, h.key);
ok('his touchdowns are looked for in the game he played that week', tds.w3 === 1 && tds.w4 === 1 && tds.w3wrong === 0 && tds.w4wrong === 0, JSON.stringify(tds));
// Sleeper writing his name differently after the trade still finds him
const again = await p.evaluate(() => lvMatch({ player_id: '11628', team: 'HOU', player: { first_name: 'Marvin', last_name: 'Harrison', position: 'WR', team: 'HOU' } }));
ok('a traded player Sleeper names a little differently is still matched to him', again === h.id, `${again} / ${h.id}`);
// search by team, and Markets, which is built as the page loads
const elsewhere = await p.evaluate((key) => {
  document.querySelector('.burger').click();
  onPanelSearch('leaders', 'hou');
  const found = [...document.querySelectorAll('#panel .ld-row')].some((r) => /Marvin Harrison/.test(r.textContent));
  clearPanelSearch('leaders');
  document.querySelector('.burger').click();
  // Markets: everyone in it who has moved since the list was made
  // (the colour is the new team's: compare with a player who was always there)
  const colorOf = (tm) => (MARKET.find((q) => q.tm === tm && NFL_BY_ID[q.id] && !NFL_BY_ID[q.id].tm0) || {}).color;
  const movedMk = MARKET.filter((q) => NFL_BY_ID[q.id] && NFL_BY_ID[q.id].tm0 && NFL_BY_ID[q.id].tm0 !== NFL_BY_ID[q.id].tm);
  return { found, mk: movedMk.length, mkRight: movedMk.every((q) => q.tm === NFL_BY_ID[q.id].tm && (!colorOf(q.tm) || q.color === colorOf(q.tm))), eg: movedMk.slice(0, 3).map((q) => q.short + ' ' + q.tm) };
}, h.key);
ok('searching "HOU" in the side menu finds him', elsewhere.found);
ok(`Markets (built as the page loads) has everyone who moved on his new team, in its colours (${elsewhere.mk})`, elsewhere.mk > 0 && elsewhere.mkRight, elsewhere.eg.join(', '));
// your own starter traded before his new team plays: his row, his lock, his sheet
await p.evaluate(() => { document.getElementById('statSheet') && closeStatSheet(); showTab('matchup'); pickWeek(4); document.getElementById('scroll').scrollTop = 0; });
await p.waitForTimeout(400);
const nico = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#userLineup .st-row')], i = rows.findIndex((r) => /N\. Collins/.test(r.querySelector('.st-side').textContent));
  if (i < 0) return null;
  const r = rows[i], side = r.querySelector('.st-side'), mid = r.querySelector('.st-mid, .tapslot, .lockslot');
  const out = { line: side.innerText.replace(/\s+/g, ' '), editable: !!r.querySelector('.tapslot'), locked: !!r.querySelector('.lockslot'), label: gameLabel('MIA', 4) };
  r.querySelector('.st-pts').click();
  out.sheet = { m: (document.querySelector('#statSheet .ss-m') || {}).textContent, g: (document.querySelector('#statSheet .ss-g') || {}).textContent };
  closeStatSheet();
  return out;
});
ok('your starter traded to Miami shows Miami\'s game in your lineup', nico && nico.line.includes(nico.label) && /\bMIA\b/.test(nico.line), nico && nico.line);
ok('and is not locked: Miami has not kicked off (Houston had)', nico && nico.editable && !nico.locked, JSON.stringify(nico && { editable: nico.editable, locked: nico.locked }));
ok('his stats sheet is Miami\'s too', nico && /\bMIA\b/.test(nico.sheet.m || '') && (nico.sheet.g || '').includes(nico.label), nico && JSON.stringify(nico.sheet));
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
