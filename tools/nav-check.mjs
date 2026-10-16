// The header and the inbox. Chat and notifications sit on the right, next to
// the menu, on the matchup screen as on every other; there is no back arrow
// in the top left; and chat, notifications and transactions are one place
// with three tabs, so the side rail no longer carries Chat or Transactions.
// Runs on City Boys (which has transactions) and the real City Boys Dynasty
// import from fixtures/league.
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
const tap = (sel) => p.evaluate((sel) => document.querySelector(sel).click(), sel);

// the header on screen: what is in it, left to right, and whether a back arrow is anywhere in it
const header = () => p.evaluate(() => {
  const stage = document.querySelector('.view.on[data-view="matchup"]') && document.querySelector('.shift').classList.contains('stage-on');
  const root = stage ? document.querySelector('#userHero .ms-chrome') : document.querySelector('.leaguebar');
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, cx: (r.left + r.right) / 2 }; };
  const title = root.querySelector('.ms-title, .league-id'), chat = root.querySelector('[data-chat], #lbChat'), bell = root.querySelector('[data-bell], #lbBell'), menu = root.querySelector('[data-menu], .burger');
  const arrow = [...root.querySelectorAll('svg path')].some((pth) => /^m15 18-6-6 6-6$/.test(pth.getAttribute('d') || ''));
  const vis = (e) => !!e && e.getBoundingClientRect().width > 0;
  return { stage, arrow, title: box(title), chat: vis(chat) ? box(chat) : null, bell: box(bell), menu: box(menu) };
});
const order = (h) => h.chat && h.title.r < h.chat.l && h.chat.r < h.bell.l && h.bell.r < h.menu.l && h.chat.cx > 195 && h.title.cx < 195;
const inbox = () => p.evaluate(() => ({
  view: currentViewName(),
  tabs: [...document.querySelectorAll('.view.on .ib-b')].map((t) => t.firstChild.textContent + (t.classList.contains('on') ? '*' : '')),
  counts: Object.fromEntries([...document.querySelectorAll('.view.on .ib-b')].map((t) => [t.dataset.ib, t.querySelector('.ib-n').style.display === 'none' ? 0 : +t.querySelector('.ib-n').textContent])),
  rows: { chat: document.querySelectorAll('#chLog > *').length, notifs: document.querySelectorAll('#notifBody .nt').length, log: document.querySelectorAll('#logBody .tx').length || document.querySelectorAll('#logBody > :not(.ib-seg):not(.tx-empty)').length },
  backs: document.querySelectorAll('.view.on .ch-back, .view.on .nt-back').length
}));

console.log('City Boys');
await p.evaluate(() => { openLeague('cbd'); autoDraftAll(); showTab('matchup'); liveRefresh(true); });
await p.waitForTimeout(2000);
let h = await header();
ok('matchup screen: the league on the left; chat, bell and menu on the right, in that order', h.stage && order(h), JSON.stringify([h.title.cx, h.chat && h.chat.cx, h.bell.cx, h.menu.cx].map(Math.round)));
ok('no back arrow', !h.arrow);
for (const [name, go] of [['team', () => showTab('team')], ['league', () => showLeagueView()], ['standings', () => showTab('standings')], ['settings', () => openSettings()], ['another team', () => openTeam(Object.keys(T).find((k) => k !== 'pandas'))], ['a player', () => { showTab('team'); document.querySelector('#teamBody .tv-row').click(); }]]) {
  await p.evaluate(go);
  await p.waitForTimeout(250);
  h = await header();
  ok(`${name}: the same order in the league bar, and no back arrow`, !h.stage && order(h) && !h.arrow && !(await p.evaluate(() => !!document.querySelector('.hubback'))), JSON.stringify([h.title.cx, h.chat && h.chat.cx, h.bell.cx, h.menu.cx].map(Math.round)));
}
await p.screenshot({ path: OUT + '/nav-player.png', clip: { x: 0, y: 0, width: 390, height: 420 } });
// the card closes itself, back to where it was opened
await tap('#playerBody .pc-close');
await p.waitForTimeout(250);
ok('a player card closes with its own button, back to where it was opened', await p.evaluate(() => currentViewName()) === 'team');

// the side rail
await p.evaluate(() => toggleDrawer());
await p.waitForTimeout(400);
const rail = await p.evaluate(() => [...document.querySelectorAll('#rail .rail-item .lb')].map((e) => e.textContent));
ok('the side rail no longer has Chat or Transactions; the rest are there', !rail.includes('Chat') && !rail.includes('Transactions') && ['Trending', 'Available', 'Leaders', 'Trades', 'Scores', 'News', 'Settings'].every((x) => rail.includes(x)), rail.join(', '));
await p.screenshot({ path: OUT + '/nav-rail.png' });
await p.evaluate(() => toggleDrawer());
await p.waitForTimeout(400);

// one inbox
await p.evaluate(() => { markAllRead(); pushNotif({ type: NOTIF_TYPES[0][0], title: 'Waivers open', body: 'One' }); pushNotif({ type: NOTIF_TYPES[0][0], title: 'Waivers closing', body: 'Two' }); showTab('matchup'); renderUserMatchup(); });
await p.waitForTimeout(300);
await tap('#userHero [data-chat]');
await p.waitForTimeout(250);
let ib = await inbox();
ok('the chat button opens the inbox on Chat', ib.view === 'chat' && ib.tabs.join() === 'Chat*,Notifications,Transactions', ib.tabs.join(' '));
ok('the Notifications tab carries the unread count, as the bell does', ib.counts.notifs === 2, JSON.stringify(ib.counts));
ok('no back arrows in it', ib.backs === 0);
await tap('.view.on .ib-b[data-ib=log]');
await p.waitForTimeout(250);
ib = await inbox();
ok('Transactions: the league\'s transactions, under the same tabs', ib.view === 'log' && ib.tabs.join() === 'Chat,Notifications,Transactions*' && ib.rows.log > 0, `${ib.rows.log} rows`);
await p.screenshot({ path: OUT + '/nav-log.png' });
await tap('.view.on .ib-b[data-ib=notifs]');
await p.waitForTimeout(250);
ib = await inbox();
ok('Notifications: the notifications, under the same tabs', ib.view === 'notifs' && ib.tabs.join() === 'Chat,Notifications*,Transactions' && ib.rows.notifs >= 2, `${ib.rows.notifs} rows`);
await tap('#notifBody .nt-clear');
await p.waitForTimeout(200);
ib = await inbox();
ok('marking them read clears the tab\'s count and the bell\'s', ib.counts.notifs === 0 && await p.evaluate(() => { const b = document.querySelector('#lbBell .b'); return !b || b.style.display === 'none'; }));
await p.evaluate(() => { showTab('team'); });
await p.waitForTimeout(200);
await tap('#lbBell');
await p.waitForTimeout(250);
ok('the bell opens the inbox on Notifications', (await inbox()).tabs.join() === 'Chat,Notifications*,Transactions');
await tap('.view.on .ib-b[data-ib=chat]');
await p.waitForTimeout(250);
ok('and Chat is a tap away', (await inbox()).view === 'chat');
// a conversation with one manager: the tabs stay, and Chat goes back to the league chat
const other = await p.evaluate(() => Object.keys(T).find((k) => k !== 'pandas'));
await p.evaluate((k) => openThread(k), other);
await p.waitForTimeout(250);
ib = await inbox();
const thread = await p.evaluate(() => document.querySelector('#chatBody .ch-nm').textContent);
ok('a conversation with one manager keeps the tabs, on Chat', ib.view === 'chat' && ib.tabs[0] === 'Chat*' && thread !== 'League Chat', thread);
await tap('.view.on .ib-b[data-ib=chat]');
await p.waitForTimeout(250);
ok('tapping Chat goes back to the league chat', await p.evaluate(() => document.querySelector('#chatBody .ch-nm').textContent) === 'League Chat');
// a new message from another manager counts on the Chat tab and both chat buttons
await p.evaluate(() => showTab('team'));
// (the page's clock is frozen, so the chat is marked last seen a moment earlier)
await p.evaluate((k) => { pushMsg({ from: k, body: 'You up?' }); store.chatSeen[activeLeagueId()] = Date.now() - 1000; paintChatBadges(); }, other);
await p.waitForTimeout(200);
await tap('#lbBell');
await p.waitForTimeout(250);
ok('a new message counts on the Chat tab and on the chat button', (await inbox()).counts.chat >= 1 && await p.evaluate(() => { const b = document.querySelector('#lbChat .b'); return !!b && b.style.display !== 'none'; }), JSON.stringify((await inbox()).counts));
await p.screenshot({ path: OUT + '/nav-notifs.png' });

// the imported league
console.log('the imported league');
await p.evaluate(() => { goHome(); openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.evaluate(() => { showTab('matchup'); document.getElementById('scroll').scrollTop = 0; });
await p.waitForTimeout(300);
h = await header();
ok('the same header on its matchup screen', h.stage && order(h) && !h.arrow);
await p.screenshot({ path: OUT + '/nav-matchup.png', clip: { x: 0, y: 0, width: 390, height: 160 } });
await tap('#userHero [data-bell]');
await p.waitForTimeout(250);
ok('and the same inbox', (await inbox()).tabs.join() === 'Chat,Notifications*,Transactions');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
