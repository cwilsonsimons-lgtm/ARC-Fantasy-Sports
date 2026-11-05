// QB kneel-downs: a scoring rule the commissioner sets (points per kneel), so
// a quarterback running out the clock need not lose points for the yards a
// kneel costs. Sleeper's stats do not count kneels; ESPN's play-by-play does
// ("K.Murray kneels to IND 42 for -1 yards.", from a real game in
// fixtures/live/kneels.json). Real City Boys Dynasty import, Monday of week
// 4 with Sunday's games over: Kyler Murray (yours) and Daniel Jones (b3nt0n's)
// are given those real kneels in their week 4 games.
import { chromium } from 'playwright';
import fs from 'fs';
const R = new URL('./fixtures/', import.meta.url).pathname;
const OUT = process.argv[2] || '.';
const URL_ = 'file://' + new URL('../1stPrototype.html', import.meta.url).pathname;
const REAL = JSON.parse(fs.readFileSync(R + 'live/kneels.json'));
const text = (who) => REAL.filter((k) => k.text.includes(who)).map((k) => k.text);
// his game's summary, with drives carrying his kneels (on his team's drive)
const KNEELS = {
  401872974: { team: 'MIN', plays: text('K.Murray').slice(0, 2) },   // Murray: 2
  401872965: { team: 'IND', plays: text('D.Jones').slice(0, 1) }     // Jones: 1
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
const NOW = Date.parse('2026-10-05T14:14:00Z');
const board = (w) => {
  const d = JSON.parse(fs.readFileSync(R + `live/board_${w}.json`));
  d.events.forEach((e) => {
    const st = { ...e.status, type: { ...e.status.type } };
    if (Date.parse(e.date) < NOW - 230 * 6e4) Object.assign(st, { period: 4, clock: 0, type: { ...st.type, state: 'post', completed: true } });
    e.status = st;
    e.competitions[0].status = st;
  });
  return JSON.stringify(d);
};
const summary = (id) => {
  const f = R + 'live/summary_' + id + '.json', s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : {};
  const k = KNEELS[id];
  if (k) s.drives = { previous: [
    { team: { abbreviation: k.team === 'MIN' ? 'MIA' : 'LAR' }, plays: [{ type: { id: '5', text: 'Rush' }, text: 'D.Achane rushes to the left for 3 yards.', statYardage: 3, period: { number: 4 }, clock: { displayValue: '2:40' } }] },
    { team: { abbreviation: k.team }, plays: k.plays.map((t, i) => ({ type: { id: '5', text: 'Rush' }, text: t, statYardage: -1, period: { number: 4 }, clock: { displayValue: ['1:08', '0:34', '0:05'][i] } })) }
  ] };
  return JSON.stringify(s);
};
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
  if (u.hostname === 'api.sleeper.com') { const m = u.pathname.match(/\/(stats|projections)\/nfl\/2026\/(\d+)/); return file(r, m && R + 'live/' + (m[1] === 'stats' ? 'stats_' : 'proj_') + m[2] + '.json'); }
  if (u.hostname === 'site.api.espn.com') {
    if (u.pathname.endsWith('/scoreboard')) return fs.existsSync(R + `live/board_${u.searchParams.get('week')}.json`) ? json(r, board(u.searchParams.get('week'))) : json(r, '{"events":[]}');
    return json(r, summary(u.searchParams.get('event')));
  }
  return r.abort();
});
await p.clock.setFixedTime(new Date(NOW));
await p.goto(URL_, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
const ok = (l, c, x) => console.log((c ? '  ok   ' : '  FAIL ') + l + (x ? '  ' + x : ''));
await p.evaluate(() => { openSleeperImport(); document.getElementById('slId').value = '1312045587541020672'; document.getElementById('slFindBtn').click(); });
await p.waitForSelector('#condSheet .sl-team');
await p.evaluate(() => [...document.querySelectorAll('#condSheet .sl-team')].find((e) => /Jumpin/.test(e.textContent)).click());
await p.waitForFunction(() => lvState().at > 0, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(3000);

// points as the app has them: a player's, and every team's week 4 score
const state = () => p.evaluate(() => {
  const find = (re) => Object.values(pIdx()).find((q) => re.test(q.full || q.n) && q.pos === 'QB');
  const pts = (re) => { const q = find(re); return q ? pLive(q.proj, q.n, q) : null; };
  return {
    murray: pts(/^Kyler Murray/), jones: pts(/^Daniel Jones/), purdy: pts(/^Brock Purdy/),
    games: Object.fromEntries(getGames(4).flatMap((g) => [[g.a, g.as], [g.x, g.xs]])),
    mine: lvState().LT.a, hero: document.querySelector('#userHero .sh-score').textContent.replace(/\s/g, '')
  };
});
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(500);
const before = await state();
const kn = await p.evaluate(() => JSON.stringify(LIVE.kneels[4]));
ok('the kneel-downs are read from the play-by-play: Murray 2, Jones 1, on their own teams', /"MIN":\[\{"n":"k murray"/.test(kn) && (kn.match(/k murray/g) || []).length === 2 && (kn.match(/d jones/g) || []).length === 1 && !/achane/.test(kn), kn);

console.log('the scoring setting');
await p.evaluate(() => { openSettings(); setSetTab('scoring'); setScoringTab('rush'); });
await p.waitForTimeout(400);
const row = await p.evaluate(() => {
  const r = document.querySelector('.sc-row[data-rule="qbKneel"]');
  return r && { group: r.closest('.sc-card').querySelector('.set-title').textContent, name: r.querySelector('.sc-name').textContent, value: r.querySelector('input').value, disabled: r.querySelector('input').disabled };
});
ok('Rushing has a QB Kneel setting, under Kneel-downs, 0 to start', row && row.group === 'Kneel-downs' && row.name === 'QB Kneel' && +row.value === 0 && !row.disabled, JSON.stringify(row));
ok('at 0 a kneel changes nothing: his points are Sleeper\'s', before.murray === 0 || before.murray != null, String(before.murray));
await p.evaluate(() => document.querySelector('.sc-row[data-rule="qbKneel"] .sc-info').click());
const tip = await p.evaluate(() => (document.querySelector('.sc-row[data-rule="qbKneel"] .sc-tip') || {}).textContent || '');
ok('its explanation says what a kneel costs', /yard/.test(tip) && /0\.1/.test(tip), tip.slice(0, 90) + '...');
await p.locator('.sc-row[data-rule="qbKneel"]').screenshot({ path: OUT + '/kneel-setting.png' });
// the commissioner sets half a point a kneel
await p.fill('.sc-row[data-rule="qbKneel"] input', '0.5');
await p.dispatchEvent('.sc-row[data-rule="qbKneel"] input', 'change');
await p.waitForTimeout(300);
ok('the commissioner sets it to 0.5', await p.evaluate(() => scoreValue('qbKneel')) === 0.5);

console.log('the points');
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(500);
const after = await state();
const d = (a, b) => Math.round((a - b) * 100) / 100;
ok('Kyler Murray, 2 kneels: +1.0', d(after.murray, before.murray) === 1, `${before.murray} → ${after.murray}`);
ok('Daniel Jones, 1 kneel: +0.5', d(after.jones, before.jones) === 0.5, `${before.jones} → ${after.jones}`);
ok('a quarterback who did not kneel: the same', after.purdy === before.purdy, `${before.purdy} → ${after.purdy}`);
const myKey = await p.evaluate(() => liveSides()[0]), jonesTeam = await p.evaluate(() => Object.keys(T).find((k) => rosterPlayers(rosterOf(k)).some((q) => /^Daniel Jones/.test(q.full || q.n))));
ok('your team\'s score goes up by Murray\'s kneels, on the matchup too', d(after.mine, before.mine) === 1 && after.hero !== before.hero, `${before.hero} → ${after.hero}`);
ok('so does b3nt0n\'s, by Jones\'s (Sleeper\'s total plus the kneel)', d(after.games[jonesTeam], before.games[jonesTeam]) === 0.5, `${before.games[jonesTeam]} → ${after.games[jonesTeam]}`);
const others = Object.keys(before.games).filter((k) => k !== myKey && k !== jonesTeam);
ok('every other team\'s score is unchanged', others.every((k) => after.games[k] === before.games[k]), `mine ${myKey}, b3nt0n ${jonesTeam}; changed: ${others.filter((k) => after.games[k] !== before.games[k]).map((k) => k + ' ' + before.games[k] + '→' + after.games[k]).join(', ')}`);
const sheet = await p.evaluate(() => {
  const key = Object.keys(STAT_REF).find((k) => /Murray/.test(STAT_REF[k].n));
  openStatSheet(key);
  return document.getElementById('statBody').innerText;
});
ok('his stats sheet itemizes it: QB Kneel, 2 × 0.5, +1.00', /QB Kneel\s+2 × 0\.5\s+\+1\.00/.test(sheet), sheet.replace(/\n/g, ' | ').slice(0, 220));
await p.locator('#statSheet').screenshot({ path: OUT + '/kneel-sheet.png' });
await p.evaluate(() => closeStatSheet());

console.log('back to 0');
await p.evaluate(() => { openSettings(); setSetTab('scoring'); setScoringTab('rush'); });
await p.waitForTimeout(300);
await p.fill('.sc-row[data-rule="qbKneel"] input', '0');
await p.dispatchEvent('.sc-row[data-rule="qbKneel"] input', 'change');
await p.evaluate(() => { showTab('matchup'); pickWeek(4); });
await p.waitForTimeout(500);
const off = await state();
ok('every score is back where it was', off.murray === before.murray && off.jones === before.jones && JSON.stringify(off.games) === JSON.stringify(before.games));
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
