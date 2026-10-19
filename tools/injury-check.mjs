// Injuries. Sleeper's projection and stats rows carry each player's injury
// report on his player record; the app tags anyone not healthy by his name in
// the matchup lineups (and the bench), and his player card says what it is.
// Runs the real City Boys Dynasty import with Sleeper's real injury report
// (fixtures/live/injuries.json, week 6) laid onto the week 4 rows.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const URL_ = 'file://' + new URL('../1stPrototype.html', import.meta.url).pathname;
const INJ = JSON.parse(fs.readFileSync(R + 'live/injuries.json'));
const TAG = { Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', DNR: 'DNR', NA: 'NA' };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
// players Sleeper has since cleared, and whether Sleeper can be reached at all
let healed = new Set(), sleeperDown = false;
const withInjuries = (rows) => rows.map((r) => {
  const j = !healed.has(r.player_id) && INJ[r.player_id];
  return { ...r, player: r.player && { ...r.player, injury_status: j ? j[0] : null, injury_body_part: j ? j[1] : null, injury_notes: j ? j[2] : null, news_updated: j ? j[3] : null } };
});
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
    if (sleeperDown) return r.abort();
    const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/), f = m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json';
    return json(r, f && fs.existsSync(f) ? JSON.stringify(withInjuries(JSON.parse(fs.readFileSync(f)))) : '[]');
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
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(600);

// every player in both lineups (starters and bench): his tag on screen, and
// the one Sleeper's report calls for
const lineups = () => p.evaluate((TAG) => {
  const want = {};
  liveSides().forEach((k) => rosterPlayers(rosterOf(k)).forEach((q) => { want[q.n] = q.sid; }));
  return [...document.querySelectorAll('#userLineup .st-side')].map((side) => {
    const n = side.querySelector('.n .pk'), t = side.querySelector('.n .inj');
    if (!n) return null;
    const box = side.getBoundingClientRect(), tb = t && t.getBoundingClientRect();
    return { name: n.textContent, sid: want[n.textContent], tag: t ? t.textContent : null, title: t ? t.title : null, opp: side.classList.contains('opp'),
      whole: !t || tb.width > 8 && tb.left >= box.left - 0.5 && tb.right <= box.right + 0.5 };
  }).filter(Boolean);
}, TAG);
console.log('the matchup screen');
let rows = await lineups();
const exp = (r) => INJ[r.sid] && !healed.has(r.sid) ? TAG[INJ[r.sid][0]] : null;
const tagged = rows.filter((r) => r.tag);
ok(`every injured player in both lineups is tagged, and only they are (${tagged.length} of ${rows.length})`, rows.length > 30 && rows.every((r) => r.tag === exp(r)), rows.filter((r) => r.tag !== exp(r)).map((r) => `${r.name}:${r.tag}/${exp(r)}`).join(' '));
ok('your side and theirs both', tagged.some((r) => r.opp) && tagged.some((r) => !r.opp));
ok('Out, injured reserve and questionable each have their tag', ['O', 'IR', 'Q'].every((t) => tagged.some((r) => r.tag === t)), [...new Set(tagged.map((r) => r.tag))].join(' '));
const adams = rows.find((r) => r.name === 'D. Adams');
ok('Davante Adams, a starter Sleeper has out (knee): O by his name', adams && adams.tag === 'O' && /Out · Knee/.test(adams.title), adams && adams.title);
ok('a tag is never cut off by a long name', rows.every((r) => r.whole));
await p.locator('#userLineup').screenshot({ path: OUT + '/injury-lineup.png' });

console.log('the player card');
await p.evaluate(() => [...document.querySelectorAll('#userLineup .n .pk')].find((e) => e.textContent === 'D. Adams').parentElement.querySelector('.inj').click());
await p.waitForTimeout(500);
let card = await p.evaluate(() => {
  const c = document.querySelector('#playerBody .pc');
  return { name: c.querySelector('.pc-last').textContent, badge: (c.querySelector('.pc-hero .pc-injb') || {}).textContent, block: (c.querySelector('.pc-injury') || {}).innerText || '' };
});
ok('tapping the tag opens his card', card.name === 'Adams', card.name);
ok('the card is tagged by his team: O', card.badge === 'O');
ok('and says what it is: Out, knee, ruptured, and when it was last updated', /OUT/i.test(card.block) && /Knee · Ruptured/.test(card.block) && /Updated (\d+[mhd] ago|just now)/.test(card.block), card.block.replace(/\n/g, ' | '));
await p.locator('#playerBody .pc').screenshot({ path: OUT + '/injury-card.png' });
const healthy = rows.find((r) => !r.tag);
await p.evaluate((n) => { playerBack(); showTab('matchup'); [...document.querySelectorAll('#userLineup .n .pk')].find((e) => e.textContent === n).click(); }, healthy.name);
await p.waitForTimeout(500);
card = await p.evaluate(() => ({ badge: !!document.querySelector('#playerBody .pc-injb'), block: !!document.querySelector('#playerBody .pc-injury') }));
ok(`a healthy player's card has neither (${healthy.name})`, !card.badge && !card.block);
await p.evaluate(() => playerBack());

console.log('keeping it current');
sleeperDown = true;
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => { openLeague(myLeagues().find((l) => l.sleeper).id); showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(1500);
rows = await lineups();
ok('a reload with Sleeper out of reach still shows the last report', rows.filter((r) => r.tag).length === tagged.length, String(rows.filter((r) => r.tag).length));
sleeperDown = false;
healed = new Set(['2133']);
const fetched = await p.evaluate(async () => {
  const before = Object.keys(LIVE.loaded).filter((k) => k.startsWith('proj:')).map((k) => [k, LIVE.loaded[k]]);
  // an hour on, this week's projections (and so the report) come again
  LIVE.loaded['proj:' + lvState().week] = Date.now() - 2 * 36e5;
  await liveRefresh(true);
  return Date.now() - LIVE.loaded['proj:' + lvState().week] < 6e4;
});
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(600);
rows = await lineups();
ok('this week\'s report is fetched again after an hour', fetched);
ok('a player Sleeper clears loses his tag (Davante Adams)', !rows.find((r) => r.name === 'D. Adams').tag && rows.filter((r) => r.tag).length === tagged.length - 1);
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
