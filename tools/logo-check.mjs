// Logos stay where they are put, and the notification count sits on the bell.
//
// In a league imported from Sleeper, every sync used to put Sleeper's picture
// and name back over the team logo and name you set here, and a full sync
// wrote Sleeper's league picture over an uploaded league logo. Here a logo,
// a name and a league logo are set in the real City Boys Dynasty import
// (fixtures/league), the league is synced (live and full) and the page
// reloaded; all three must hold. City Boys' demo league is checked too. On the
// matchup screen the bell is top left, and its count used to sit in the top
// right corner of the header instead.
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
  // pictures (Sleeper's avatars) are not fetched here; their URLs are what is checked
  return r.abort();
});
await p.clock.setFixedTime(new Date('2026-10-04T19:22:00Z'));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
const SLEEPER_LEAGUE_PIC = 'https://sleepercdn.com/avatars/' + JSON.parse(fs.readFileSync(R + 'league/league.json')).avatar;

// a picture, handed over the way a phone's file picker hands one over
const pick = (fn, color) => p.evaluate(([fn, color]) => new Promise((done) => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 64, 64);
  c.toBlob((bl) => { window[fn]({ files: [new File([bl], 'logo.png', { type: 'image/png' })] }); setTimeout(() => done(c.toDataURL('image/png').length), 500); });
}), [fn, color]);
// what the screens show: your team's crest and name on the team page, your
// side's logo on the matchup screen, the league's crest on the home screen and
// behind the matchup score
const seen = () => p.evaluate(() => {
  showTab('team');
  const img = document.querySelector('#teamBody .tv-crest img'), nm = document.querySelector('#teamBody .tv-name');
  const team = { own: !!document.querySelector('#teamBody .tv-own-tag'), logo: img && img.getAttribute('src'), name: nm && nm.textContent };
  showTab('matchup');
  const hero = document.querySelector('#userHero .ms-side.L .sh-logo img') || document.querySelector('#userHero .sh-logo img');
  const wm = document.querySelector('#userHero .lg-wm img');
  return { ...team, hero: hero && hero.getAttribute('src'), wm: wm && wm.getAttribute('src') };
});
const hubCrest = (id) => p.evaluate((id) => { goHome(); const img = document.querySelector(`.hb-row[data-league="${id}"] .hb-crest img`); return img && img.getAttribute('src'); }, id);
const kind = (src) => !src ? 'none' : src.startsWith('data:image/png') ? 'upload' : src.startsWith('https://sleepercdn.com/') ? 'sleeper' : src.slice(0, 30);

await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
const LID = await p.evaluate(() => myLeagues().find((l) => l.sleeper).id);

console.log('the imported league');
let s = await seen();
ok('it opens on Sleeper\'s picture for your team and the league', s.own && kind(s.logo) === 'sleeper' && kind(s.wm) === 'sleeper' && s.wm === SLEEPER_LEAGUE_PIC, `${kind(s.logo)} / ${kind(s.wm)}`);
await p.evaluate(() => { showTab('team'); openTeam && 0; });
await pick('onLogo', '#e33');
await p.evaluate(() => setTeamName('Uncs United'));
await p.evaluate(() => { openSettings(); });
await pick('onLeagueLogo', '#3a6');
s = await seen();
const mine = s.logo;
ok('a logo, a name and a league logo set here show at once', kind(s.logo) === 'upload' && s.hero === s.logo && s.name === 'Uncs United' && kind(s.wm) === 'upload', `${kind(s.logo)} ${s.name} / ${kind(s.wm)}`);
await p.evaluate(() => liveRefresh(true));
await p.waitForTimeout(2000);
s = await seen();
ok('a live sync keeps them (it used to put Sleeper\'s back)', s.logo === mine && s.hero === mine && s.name === 'Uncs United' && kind(s.wm) === 'upload', `${kind(s.logo)} ${s.name} / ${kind(s.wm)}`);
await p.evaluate(() => { myLeagues().find((l) => l.sleeper).sleeper.at = 1; liveRefresh(true); });
await p.waitForTimeout(2500);
s = await seen();
ok('so does a full sync, league settings and managers included', s.logo === mine && s.name === 'Uncs United' && kind(s.wm) === 'upload', `${kind(s.logo)} ${s.name} / ${kind(s.wm)}`);
await p.screenshot({ path: OUT + '/logo-matchup.png' });
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
ok('after a reload the home screen shows the league logo you uploaded', kind(await hubCrest(LID)) === 'upload');
await p.evaluate((id) => openLeague(id), LID);
await p.waitForTimeout(3000);
s = await seen();
ok('and the league, opened and synced, still has all three', s.logo === mine && s.hero === mine && s.name === 'Uncs United' && kind(s.wm) === 'upload', `${kind(s.logo)} ${s.name} / ${kind(s.wm)}`);
// removing the league logo goes back to Sleeper's picture
await p.evaluate(() => { openSettings(); clearLeagueLogo(); });
s = await seen();
ok('removing the league logo falls back to Sleeper\'s league picture', s.wm === SLEEPER_LEAGUE_PIC, kind(s.wm));
// a store from before the fix: the league logo slot holding Sleeper's URL
await p.evaluate((pic) => { store.leagueLogos[myLeagues().find((l) => l.sleeper).id] = pic; myLeagues().find((l) => l.sleeper).sleeper.at = 1; saveStore(); liveRefresh(true); }, SLEEPER_LEAGUE_PIC);
await p.waitForTimeout(2500);
const left = await p.evaluate(() => (store.leagueLogos || {})[myLeagues().find((l) => l.sleeper).id] || null);
ok('a Sleeper picture saved as the league logo by the old sync is cleared out of the upload slot', !left && (await seen()).wm === SLEEPER_LEAGUE_PIC);

// another league loaded: the home screen still has your team's colours and the league's logo
console.log('City Boys (the demo league)');
await p.evaluate(() => { goHome(); openLeague('cbd'); });
await p.waitForTimeout(800);
await pick('onLogo', '#36e');
const cb = (await seen()).logo;
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.evaluate(() => openLeague('cbd'));
await p.waitForTimeout(800);
s = await seen();
ok('a logo uploaded there holds through a reload', kind(cb) === 'upload' && s.logo === cb && s.hero === cb);
await p.evaluate((id) => { goHome(); openLeague(id); }, LID);
await p.waitForTimeout(2500);
s = await seen();
ok('and switching back, the imported league still has its own', s.logo === mine && s.name === 'Uncs United', `${kind(s.logo)} ${s.name}`);

// the notification count, on the matchup screen
console.log('the bell');
await p.evaluate(() => { showTab('matchup'); document.getElementById('scroll').scrollTop = 0; markAllRead(); });
await p.waitForTimeout(300);
await p.evaluate(() => { pushNotif({ type: NOTIF_TYPES[0][0], title: 'Test', body: 'A notification' }); pushNotif({ type: NOTIF_TYPES[0][0], title: 'Test 2', body: 'Another' }); });
await p.waitForTimeout(200);
const where = () => p.evaluate(() => {
  const bell = document.querySelector('#userHero [data-bell]'), badge = bell && bell.querySelector('.ms-badge'), menu = document.querySelector('#userHero .ms-chrome > .ms-ic:last-child');
  const r = (e) => { const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom, cx: (q.left + q.right) / 2, cy: (q.top + q.bottom) / 2 }; };
  return badge && badge.style.display !== 'none' ? { bell: r(bell), badge: r(badge), menu: r(menu), n: badge.textContent } : null;
});
let w = await where();
ok('a new notification shows its count on the matchup screen\'s bell at once', w && w.n === '2', w && w.n);
ok('on the bell\'s top right corner, top left of the screen', w && Math.abs(w.badge.cx - w.bell.r) < 8 && Math.abs(w.badge.cy - w.bell.t) < 8 && w.badge.cx < 195, w && JSON.stringify({ badge: [w.badge.cx, w.badge.cy].map(Math.round), bell: [w.bell.r, w.bell.t].map(Math.round) }));
ok('not over the menu button in the top right', w && w.badge.r < w.menu.l, w && `${Math.round(w.badge.r)} < ${Math.round(w.menu.l)}`);
await p.screenshot({ path: OUT + '/logo-bell.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
await p.evaluate(() => renderUserMatchup());
w = await where();
ok('and there after the screen is drawn again', w && Math.abs(w.badge.cx - w.bell.r) < 8 && w.n === '2');
const chat = await p.evaluate(() => { const c = document.querySelector('#userHero .ms-chrome-l .ms-ic:not([data-bell])'); return c ? getComputedStyle(c).position : null; });
ok('the chat button holds its own count the same way', chat === 'relative', chat);
await p.evaluate(() => markAllRead());
ok('reading them clears it', !(await where()));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
