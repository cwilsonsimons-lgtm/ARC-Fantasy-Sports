// Import by Sleeper username: the user's leagues are listed and each comes in
// with their own team, no league ID and no picking. Sleeper's answers are built
// from the real City Boys Dynasty files in fixtures/league (the user lookup is
// that league's users entry; "benchwarmer" is a made-up account on no team).
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [], hits = [];
p.on('pageerror', e => errs.push(String(e)));
const USERS = JSON.parse(fs.readFileSync(R + 'league/users.json'));
const LEAGUE = JSON.parse(fs.readFileSync(R + 'league/league.json'));
const me = USERS.find((u) => u.display_name === 'Wilsonsimons12');
const ACCOUNTS = {
  wilsonsimons12: { user_id: me.user_id, username: 'wilsonsimons12', display_name: me.display_name, avatar: me.avatar },
  benchwarmer: { user_id: '900000000000000001', username: 'benchwarmer', display_name: 'Benchwarmer', avatar: null }
};
const body = (r, data) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
const file = (r, f) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.existsSync(f) ? fs.readFileSync(f) : '[]', headers: { 'access-control-allow-origin': '*' } });
await p.route('**', r => {
  const u = new URL(r.request().url());
  if (u.protocol === 'file:') return r.continue();
  if (u.hostname === 'api.sleeper.app') {
    hits.push(u.pathname);
    let m = u.pathname.match(/^\/v1\/user\/([^/]+)$/);
    if (m) return body(r, ACCOUNTS[decodeURIComponent(m[1])] || Object.values(ACCOUNTS).find((a) => a.user_id === m[1]) || null);
    m = u.pathname.match(/^\/v1\/user\/(\d+)\/leagues\/nfl\/(\d+)$/);
    if (m) return body(r, m[2] === '2026' && Object.values(ACCOUNTS).some((a) => a.user_id === m[1]) ? [LEAGUE] : []);
    m = u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(\w+)(?:\/(\d+))?)?$/);
    if (!m || m[1] !== LEAGUE.league_id) return r.fulfill({ status: 404, body: 'null' });
    return file(r, R + 'league/' + (!m[2] ? 'league.json' : m[2] === 'matchups' ? `matchups_${m[3]}.json` : m[2] + '.json'));
  }
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return file(r, m ? R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json' : ''); }
  if (u.hostname === 'site.api.espn.com') return file(r, R + 'live/' + (u.pathname.endsWith('/scoreboard') ? 'board_' + u.searchParams.get('week') : 'summary_' + u.searchParams.get('event')) + '.json');
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto('file://' + new URL('../1stPrototype.html', import.meta.url).pathname, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(700);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const sheetText = () => p.evaluate(() => document.getElementById('condSheet').innerText.replace(/\s+/g, ' '));

// 1. first time: asked for a username, with the league ID as the other way in
await p.locator('.hb-new', { hasText: 'Import from Sleeper' }).click();
await p.waitForTimeout(200);
ok('first import asks for a Sleeper username, league ID offered too', (await p.locator('#slUser').count()) === 1 && (await p.locator('#slId').count()) === 1);
await p.screenshot({ path: OUT + '/sl-user-ask.png' });
// 2. a name Sleeper does not know
await p.fill('#slUser', 'nobody-here');
await p.locator('#slUserBtn').click();
await p.waitForTimeout(300);
ok('an unknown username says so', /No Sleeper account is called/.test(await sheetText()));
// 3. the real account (typed with an @ and capitals): its leagues are listed
await p.fill('#slUser', '@Wilsonsimons12');
await p.locator('#slUserBtn').click();
await p.waitForSelector('#slLeagues .sl-team');
const list = await p.locator('#slLeagues .sl-team').allInnerTexts();
ok('the account\'s 2026 leagues are listed', list.length === 1 && /City Boys Dynasty/.test(list[0]) && /10 teams/.test(list[0]) && /Import/.test(list[0]), list.join(' | ').replace(/\s+/g, ' '));
await p.screenshot({ path: OUT + '/sl-user-leagues.png' });
// 4. tapping it imports with the user's own team, no picker
await p.locator('#slLeagues .sl-team').first().click();
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
const st = await p.evaluate(() => { const r = myLeagues().find((l) => l.sleeper); return { name: r && r.name, me: r && r.teams[0].n, mgr: r && r.teams[0].mgr, picker: !!document.querySelector('#condSheet.show .sl-team'), view: currentViewName() }; });
ok(`imported as the user's own team (${st.me}), without picking`, st.name === 'City Boys Dynasty' && /Jumpin/.test(st.me) && st.mgr === 'Wilsonsimons12' && !st.picker, JSON.stringify(st));
// 5. next time it goes straight to the list, and the league reads Open
await p.evaluate(() => { goHome(); openSleeperImport(); });
await p.waitForSelector('#slLeagues .sl-team');
const again = await p.locator('#slLeagues .sl-team').first().innerText();
ok('the username is remembered: straight to the list, the league marked Open', (await p.locator('#slUser').count()) === 0 && /Open/.test(again), again.replace(/\s+/g, ' '));
// an import pulls every week's matchups; opening an imported league does not
const weeksPulled = () => hits.filter((h) => /\/matchups\//.test(h)).length;
const before = weeksPulled();
await p.locator('#slLeagues .sl-team').first().click();
await p.waitForTimeout(1500);
const opened = await p.evaluate(() => ({ sheet: !!document.querySelector('#condSheet.show'), view: currentViewName() }));
ok('Open goes to the league without importing it again', !opened.sheet && opened.view === 'matchup' && weeksPulled() - before < 4, `${weeksPulled() - before} weeks pulled`);
// 6. a league ID with the username known: the user's team leads the list, marked
await p.evaluate(() => { goHome(); slAsk(); });
await p.fill('#slId', LEAGUE.league_id);
await p.locator('#slFindBtn').click();
await p.waitForSelector('#condSheet .sl-team');
const first = await p.locator('#condSheet .sl-team').first().innerText();
ok('by league ID, the user\'s own team is first and marked You', /You/.test(first) && /Jumpin/.test(first), first.replace(/\s+/g, ' '));
await p.evaluate(() => closeCond());
// 7. Not you? forgets the name; an account on no team in the league gets the picker
await p.evaluate(() => { openSleeperImport(); });
await p.waitForSelector('#slLeagues .sl-team');
await p.locator('.sl-link', { hasText: 'Not you?' }).click();
await p.waitForTimeout(200);
ok('"Not you?" forgets the username', (await p.locator('#slUser').count()) === 1 && (await p.evaluate(() => !JSON.parse(localStorage.getItem('cbd_team_v1') || '{}').sleeperUser)));
await p.fill('#slUser', 'benchwarmer');
await p.locator('#slUserBtn').click();
await p.waitForSelector('#slLeagues .sl-team');
await p.locator('#slLeagues .sl-team').first().click();
await p.waitForSelector('#condSheet .sl-help');
await p.waitForTimeout(300);
ok('an account on no team in the league picks from the list', /isn't on a team in this league/.test(await sheetText()) && (await p.locator('#condSheet .sl-team').count()) === 10);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
